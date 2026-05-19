// Generic MCP client manager.
// Maintains a pool of connections to user-configured MCP servers (stdio +
// streamable HTTP / SSE). Configs live in SQLite (`mcp_servers`); this manager
// is the runtime that spawns / connects / queries them.
//
// Distinct from `windowsMcpManager.js`, which is a hardcoded single-server
// fast-path for Windows desktop control.

const debugLogger = require("./debugLogger");

const CONNECT_TIMEOUT_MS = 20000;
const TOOL_CALL_TIMEOUT_MS = 60000;
const SHELL_ON_WIN32 = process.platform === "win32";

class McpManager {
  constructor({ databaseManager } = {}) {
    this.db = databaseManager || null;
    this.connections = new Map(); // name -> { client, transport, tools, status, lastError }
    this._sdkModulesPromise = null;
  }

  _loadSdk() {
    if (!this._sdkModulesPromise) {
      this._sdkModulesPromise = (async () => {
        const [{ Client }, stdioMod, httpMod, sseMod] = await Promise.all([
          import("@modelcontextprotocol/sdk/client/index.js"),
          import("@modelcontextprotocol/sdk/client/stdio.js"),
          import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
          import("@modelcontextprotocol/sdk/client/sse.js"),
        ]);
        return {
          Client,
          StdioClientTransport: stdioMod.StdioClientTransport,
          StreamableHTTPClientTransport: httpMod.StreamableHTTPClientTransport,
          SSEClientTransport: sseMod.SSEClientTransport,
        };
      })().catch((err) => {
        this._sdkModulesPromise = null;
        throw err;
      });
    }
    return this._sdkModulesPromise;
  }

  static parseConfig(input) {
    if (input == null) throw new Error("Empty config");
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch (err) {
        throw new Error(`Invalid JSON: ${err.message}`);
      }
    }
    if (typeof input !== "object") throw new Error("Config must be an object");

    const out = [];
    if (input.mcpServers && typeof input.mcpServers === "object") {
      for (const [name, raw] of Object.entries(input.mcpServers)) {
        out.push(McpManager._normalizeOne(name, raw));
      }
    } else if (input.name) {
      out.push(McpManager._normalizeOne(input.name, input));
    } else {
      throw new Error(
        'Expected either { "mcpServers": { ... } } or a single server with a "name" field'
      );
    }
    if (out.length === 0) throw new Error("No servers in config");
    return out;
  }

  static _normalizeOne(name, raw) {
    if (!name || typeof name !== "string") {
      throw new Error("Server name must be a non-empty string");
    }
    if (!raw || typeof raw !== "object") {
      throw new Error(`Server "${name}": entry must be an object`);
    }
    if (typeof raw.url === "string" && raw.url.trim()) {
      return {
        name,
        transport: "http",
        url: raw.url.trim(),
        headers: raw.headers && typeof raw.headers === "object" ? raw.headers : undefined,
      };
    }
    if (typeof raw.command === "string" && raw.command.trim()) {
      return {
        name,
        transport: "stdio",
        command: raw.command.trim(),
        args: Array.isArray(raw.args) ? raw.args.map(String) : [],
        env: raw.env && typeof raw.env === "object" ? raw.env : undefined,
        cwd: typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim() : undefined,
      };
    }
    throw new Error(`Server "${name}": must specify either "command" or "url"`);
  }

  static serializeConfig(normalized) {
    const { transport: _t, name: _n, ...rest } = normalized;
    return JSON.stringify(rest);
  }

  async init() {
    if (!this.db) return;
    const servers = this.db.listMcpServers();
    for (const s of servers) {
      if (!s.enabled) continue;
      this._connectFromRow(s).catch((err) => {
        debugLogger.error("MCP auto-connect failed", { name: s.name, error: err.message }, "mcp");
      });
    }
  }

  async _connectFromRow(row) {
    let parsed;
    try {
      parsed = { name: row.name, transport: row.transport, ...JSON.parse(row.config_json) };
    } catch (err) {
      this._markStatus(row.name, "error", `Invalid stored config: ${err.message}`);
      return;
    }
    await this.connect(parsed);
  }

  async connect(config) {
    await this.disconnect(config.name).catch(() => {});

    const { Client, StdioClientTransport, StreamableHTTPClientTransport, SSEClientTransport } =
      await this._loadSdk();

    let transport;
    if (config.transport === "stdio") {
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: config.env,
        cwd: config.cwd,
        shell: SHELL_ON_WIN32 ? true : undefined,
        stderr: "pipe",
      });
    } else if (config.transport === "http") {
      const url = new URL(config.url);
      const opts = config.headers ? { requestInit: { headers: config.headers } } : undefined;
      try {
        transport = new StreamableHTTPClientTransport(url, opts);
      } catch {
        transport = new SSEClientTransport(url, opts);
      }
    } else {
      throw new Error(`Unknown transport: ${config.transport}`);
    }

    const client = new Client({ name: "openwhispr", version: "1.6.9" }, { capabilities: {} });

    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Connect timeout after ${CONNECT_TIMEOUT_MS}ms`)),
          CONNECT_TIMEOUT_MS
        )
      ),
    ]);

    let tools = [];
    try {
      const result = await client.listTools();
      tools = Array.isArray(result?.tools) ? result.tools : [];
    } catch (err) {
      debugLogger.warn("MCP listTools failed", { name: config.name, error: err.message }, "mcp");
    }

    this.connections.set(config.name, {
      client,
      transport,
      tools,
      status: "connected",
      lastError: null,
    });
    this._markStatus(config.name, "connected", null);
    debugLogger.info("MCP connected", { name: config.name, toolCount: tools.length }, "mcp");
    return { name: config.name, status: "connected", toolCount: tools.length, tools };
  }

  async disconnect(name) {
    const entry = this.connections.get(name);
    if (!entry) return;
    this.connections.delete(name);
    try {
      await entry.client.close();
    } catch (err) {
      debugLogger.warn("MCP close error", { name, error: err.message }, "mcp");
    }
    this._markStatus(name, "disconnected", null);
  }

  isConnected(name) {
    return this.connections.has(name);
  }

  listTools(name) {
    const entry = this.connections.get(name);
    return entry ? entry.tools : [];
  }

  allTools() {
    const out = [];
    for (const [name, entry] of this.connections) {
      for (const tool of entry.tools) {
        out.push({ serverName: name, tool });
      }
    }
    return out;
  }

  async callTool(serverName, toolName, args) {
    const entry = this.connections.get(serverName);
    if (!entry) throw new Error(`MCP server "${serverName}" is not connected`);
    return Promise.race([
      entry.client.callTool({ name: toolName, arguments: args || {} }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool call timeout after ${TOOL_CALL_TIMEOUT_MS}ms`)),
          TOOL_CALL_TIMEOUT_MS
        )
      ),
    ]);
  }

  _markStatus(name, status, lastError) {
    if (this.db) {
      try {
        this.db.updateMcpServerStatus(name, status, lastError);
      } catch (err) {
        debugLogger.warn("MCP DB status update failed", { error: err.message }, "mcp");
      }
    }
  }

  async addFromInput(rawInput, { autoConnect = true } = {}) {
    const configs = McpManager.parseConfig(rawInput);
    const results = [];
    for (const cfg of configs) {
      const serialized = McpManager.serializeConfig(cfg);
      if (this.db) {
        this.db.upsertMcpServer({
          name: cfg.name,
          transport: cfg.transport,
          configJson: serialized,
          enabled: true,
        });
      }
      if (autoConnect) {
        try {
          const r = await this.connect(cfg);
          results.push({ name: cfg.name, status: "connected", toolCount: r.toolCount });
        } catch (err) {
          this._markStatus(cfg.name, "error", err.message);
          results.push({ name: cfg.name, status: "error", error: err.message });
        }
      } else {
        results.push({ name: cfg.name, status: "saved" });
      }
    }
    return results;
  }

  async removeServer(name) {
    await this.disconnect(name);
    if (this.db) this.db.deleteMcpServer(name);
    return { success: true };
  }

  async setEnabled(name, enabled) {
    if (this.db) this.db.setMcpServerEnabled(name, enabled);
    if (enabled) {
      const row = this.db?.getMcpServer(name);
      if (!row) throw new Error(`Server "${name}" not found`);
      await this._connectFromRow(row);
    } else {
      await this.disconnect(name);
    }
    return this.db?.getMcpServer(name);
  }

  listWithRuntime() {
    if (!this.db) return [];
    const rows = this.db.listMcpServers();
    return rows.map((row) => {
      const entry = this.connections.get(row.name);
      return {
        ...row,
        runtimeStatus: entry ? "connected" : row.status || "disconnected",
        toolCount: entry ? entry.tools.length : 0,
        tools: entry ? entry.tools : [],
      };
    });
  }

  async shutdown() {
    const names = [...this.connections.keys()];
    await Promise.all(names.map((n) => this.disconnect(n).catch(() => {})));
  }
}

module.exports = McpManager;
