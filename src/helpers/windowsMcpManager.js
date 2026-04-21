const { spawn, execFileSync } = require("child_process");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const debugLogger = require("./debugLogger");

// Windows-MCP fallback: lets the voice assistant drive Windows UI when no
// existing skill covers the intent. Uses `uvx windows-mcp` as the MCP server
// (stdio transport) and the already-running local llama-server to pick which
// MCP tool to invoke. v1 is single-step (no ReAct loop).

const STARTUP_TIMEOUT_MS = 30000;
// Bumped from 20s → 60s because CPU-fallback llama-server (Vulkan backend
// failing on this box) takes 15-25s just to prefill 18 MCP tool schemas.
const EXECUTE_TIMEOUT_MS = 60000;
// Specific guidance matters on a 4B local model — generic "pick the best tool"
// lets Qwen3 pick App(switch,null) for minimize requests. Map common phrasings
// directly to a tool + arguments.
const SYSTEM_PROMPT = [
  "You control a Windows PC by returning ONE MCP tool call.",
  "",
  "Mapping guide (prefer these over App/switch):",
  "- 最小化当前窗口 / minimize current window → Shortcut with shortcut='win+down'",
  "- 最小化全部 / 显示桌面 / show desktop   → Shortcut with shortcut='win+d'",
  "- 最大化当前窗口 / maximize              → Shortcut with shortcut='win+up'",
  "- 切换窗口 / switch window / alt-tab      → Shortcut with shortcut='alt+tab'",
  "- 关闭当前窗口 / close window             → Shortcut with shortcut='alt+f4'",
  "- 复制/粘贴/全选                           → Shortcut with ctrl+c / ctrl+v / ctrl+a",
  "- 截屏 / screenshot                        → Screenshot",
  "- 打字 xxx / type xxx                      → Type with the text",
  "- 滚动 / scroll                            → Scroll",
  "- 读/写剪贴板                              → Clipboard",
  "- 跑一条 PowerShell 命令                   → PowerShell",
  "- 启动/切换到应用 XXX（有具体名字）        → App mode='switch' name='XXX'",
  "",
  "Rules:",
  "- Pick exactly ONE tool. No multi-step plans in this call.",
  "- NEVER pass null, empty string, or placeholder for a required field.",
  "  If the user didn't name a concrete app, use Shortcut instead of App.",
  "- If nothing fits, reply as plain assistant text (no tool call).",
  "- Reply in the user's language for any final summary.",
].join("\n");

// Fast-path regex table: common desktop intents that have one obvious MCP call.
// On match we invoke the tool directly (no LLM round-trip) — brings typical
// latency from ~30s on CPU fallback down to <1s. Order matters: specific
// patterns must come before general ones (e.g. "显示桌面" before bare "最小化").
const RULE_TABLE = [
  // Display / window management
  { re: /(显示桌面|最小化全部|最小化所有|show desktop)/i, tool: "Shortcut", args: { shortcut: "win+d" } },
  { re: /(最小化|minimize)/i, tool: "Shortcut", args: { shortcut: "win+down" } },
  { re: /(最大化|maximize)/i, tool: "Shortcut", args: { shortcut: "win+up" } },
  { re: /(切换窗口|切窗口|alt[ \-]?tab|switch window)/i, tool: "Shortcut", args: { shortcut: "alt+tab" } },
  { re: /(关闭(当前)?窗口|关掉窗口|close window)/i, tool: "Shortcut", args: { shortcut: "alt+f4" } },
  // Clipboard / editing (全选 must precede 复制 because "复制" substring overlaps none but keep order explicit)
  { re: /(全选|select all)/i, tool: "Shortcut", args: { shortcut: "ctrl+a" } },
  { re: /(复制|copy)(?!.*粘贴)/i, tool: "Shortcut", args: { shortcut: "ctrl+c" } },
  { re: /(粘贴|贴上|paste)/i, tool: "Shortcut", args: { shortcut: "ctrl+v" } },
  { re: /(剪切|cut)/i, tool: "Shortcut", args: { shortcut: "ctrl+x" } },
  { re: /(撤销|undo)/i, tool: "Shortcut", args: { shortcut: "ctrl+z" } },
  { re: /(重做|redo)/i, tool: "Shortcut", args: { shortcut: "ctrl+y" } },
  // System
  { re: /(锁屏|锁定屏幕|lock screen)/i, tool: "Shortcut", args: { shortcut: "win+l" } },
  { re: /(任务管理器|task manager)/i, tool: "Shortcut", args: { shortcut: "ctrl+shift+esc" } },
  { re: /(运行对话框|run dialog|打开运行)/i, tool: "Shortcut", args: { shortcut: "win+r" } },
  { re: /(开始菜单|start menu)/i, tool: "Shortcut", args: { shortcut: "win" } },
  // Screenshot
  { re: /(截图|截屏|截一张屏|截个屏|screenshot)/i, tool: "Screenshot", args: {} },
];

// Chinese display names → Windows executable/AppX identifiers that Windows-MCP's
// `App` tool can actually launch. The LLM tends to forward "记事本" verbatim,
// which fails. Intercept with a fast-path.
const APP_NAME_MAP = new Map([
  // built-ins
  ["记事本", "notepad"],
  ["计算器", "calc"],
  ["画图", "mspaint"],
  ["写字板", "wordpad"],
  ["任务管理器", "taskmgr"],
  ["命令提示符", "cmd"],
  ["控制面板", "control"],
  ["设置", "ms-settings:"],
  ["文件资源管理器", "explorer"],
  ["资源管理器", "explorer"],
  ["注册表编辑器", "regedit"],
  ["录音机", "soundrecorder"],
  ["便签", "stickynotes"],
  ["截图工具", "snippingtool"],
  ["远程桌面", "mstsc"],
  // browsers / common
  ["浏览器", "chrome"],
  ["谷歌浏览器", "chrome"],
  ["edge浏览器", "msedge"],
  ["edge", "msedge"],
  ["chrome", "chrome"],
  ["firefox", "firefox"],
  ["火狐", "firefox"],
  // chat
  ["微信", "wechat"],
  ["qq", "qq"],
  ["钉钉", "dingtalk"],
  // dev
  ["vscode", "code"],
  ["vs code", "code"],
  ["记事本++", "notepad++"],
]);

function normalizeAppName(rawName) {
  const name = rawName.trim().toLowerCase();
  if (APP_NAME_MAP.has(name)) return APP_NAME_MAP.get(name);
  // Tolerate Chinese users writing "chrome浏览器" etc.
  for (const [alias, exe] of APP_NAME_MAP) {
    if (name.includes(alias)) return exe;
  }
  return rawName.trim();
}

// Match "打开/启动/open/launch XXX" and resolve XXX to an executable name.
const APP_LAUNCH_RE = /^(?:打开|启动|open|launch)\s*(.+?)\s*$/i;

// Match "(optional TARGET preamble)(输入|打字|键入|type) TEXT". MCP's Type tool
// needs coordinates; we bypass with clipboard + focus-switch + ctrl+v.
// Preamble forms accepted:
//   "在notepad里" / "在当前窗口" / "在记事本中"  ← with 在 + optional 里/中
//   "notepad"      / "当前窗口"                   ← bare target, no 在
//   (no preamble)                                 ← current window
// Group 1 = target (if any), Group 2 = text.
const TYPE_TEXT_RE = /^(?:(?:在\s*)?([^\s][^\s]*?)\s*(?:里|中|内|面|上)?\s*)?(?:输入|打字|键入|敲入|type)\s*[:：]?\s*(.+?)\s*$/i;

// Targets that mean "the window the user was just looking at" — alt+tab
// away from XiaoZhi, don't try to resolve to an executable.
const CURRENT_WINDOW_RE = /^(当前窗口|这里|这|本窗口|这个窗口|current\s*window|this\s*window)$/i;

// Match "(在)?TARGET (里|中|内)? ACTION" where ACTION is an edit shortcut.
// Used to scope 全选/复制/粘贴 to a named app instead of XiaoZhi's chat.
const TARGETED_EDIT_RE = /^(?:在\s*)?(.+?)\s*(?:里|中|内|面|上)?\s*(全选|复制|粘贴|剪切|撤销|重做|select\s*all|copy|paste|cut|undo|redo)\s*$/i;

// Normalize the edit verb → keyboard shortcut.
const EDIT_VERB_TO_SHORTCUT = new Map([
  ["全选", "ctrl+a"],
  ["select all", "ctrl+a"],
  ["复制", "ctrl+c"],
  ["copy", "ctrl+c"],
  ["粘贴", "ctrl+v"],
  ["paste", "ctrl+v"],
  ["剪切", "ctrl+x"],
  ["cut", "ctrl+x"],
  ["撤销", "ctrl+z"],
  ["undo", "ctrl+z"],
  ["重做", "ctrl+y"],
  ["redo", "ctrl+y"],
]);

function checkUvxAvailable() {
  // 1) PATH lookup via where.exe / which.
  try {
    const finder = process.platform === "win32" ? "where.exe" : "which";
    const out = execFileSync(finder, ["uv"], {
      encoding: "utf-8",
      timeout: 3000,
      windowsHide: true,
    });
    const firstLine = out.split(/\r?\n/).find((s) => s.trim().length > 0);
    if (firstLine) return { available: true, uvPath: firstLine.trim() };
  } catch {
    /* fall through */
  }

  // 2) Fallback: astral's PowerShell installer drops uv into ~/.local/bin
  //    even when that dir isn't on PATH yet (fresh install, no shell restart).
  const isWin = process.platform === "win32";
  const candidates = [
    path.join(os.homedir(), ".local", "bin", isWin ? "uv.exe" : "uv"),
    path.join(os.homedir(), ".cargo", "bin", isWin ? "uv.exe" : "uv"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return { available: true, uvPath: candidate };
    } catch {
      /* skip */
    }
  }
  return { available: false };
}

// Broadcast to all renderer windows — mirrors googleCalendarManager pattern.
function broadcastToWindows(channel, data) {
  try {
    const { BrowserWindow } = require("electron");
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  } catch (err) {
    debugLogger.debug("windows-mcp broadcast failed", { error: err?.message });
  }
}

class WindowsMcpManager {
  constructor({ getLlamaPort } = {}) {
    this.process = null;
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.available = false; // uv on PATH AND subprocess ready
    this.starting = false;
    this.getLlamaPort = typeof getLlamaPort === "function" ? getLlamaPort : () => null;
  }

  isAvailable() {
    return this.available;
  }

  getStatus() {
    return {
      available: this.available,
      toolCount: this.tools.length,
      running: Boolean(this.process) && !this.process.killed,
    };
  }

  async start() {
    if (this.available) return;
    if (this.starting) return;
    this.starting = true;

    try {
      const check = checkUvxAvailable();
      if (!check.available) {
        debugLogger.info("[windows-mcp] uv not on PATH, skill disabled");
        this.available = false;
        broadcastToWindows("windows-mcp-ready", { available: false });
        return;
      }

      // Dynamic import — SDK is ESM-only.
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { StdioClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/stdio.js"
      );

      // uvx sits next to uv in the same directory.
      const uvDir = path.dirname(check.uvPath);
      const uvxName = process.platform === "win32" ? "uvx.exe" : "uvx";
      const uvxPath = path.join(uvDir, uvxName);
      const uvxCommand = fs.existsSync(uvxPath) ? uvxPath : uvxName;

      // Ensure uv's dir is on PATH for any child-of-child processes
      // (uvx will shell out to python, which relies on PATH resolution).
      const augmentedPath = [uvDir, process.env.PATH || ""]
        .filter(Boolean)
        .join(path.delimiter);

      debugLogger.info("[windows-mcp] spawning uvx windows-mcp", { uvxCommand });
      this.transport = new StdioClientTransport({
        command: uvxCommand,
        args: ["windows-mcp"],
        stderr: "pipe",
        env: { ...process.env, PATH: augmentedPath },
      });

      this.client = new Client({ name: "xiaozhi-voice", version: "0.1.0" });

      const connectPromise = this.client.connect(this.transport);
      await Promise.race([
        connectPromise,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`windows-mcp connect timed out after ${STARTUP_TIMEOUT_MS}ms`)),
            STARTUP_TIMEOUT_MS
          )
        ),
      ]);

      const listed = await this.client.listTools();
      const all = Array.isArray(listed?.tools) ? listed.tools : [];

      // Windows-MCP 0.7.1 exposes 18 tools; the full schema is ~15KB, which
      // takes 60s+ to prefill on CPU-fallback llama-server. Keep only the
      // 8 common desktop-control tools — this covers minimize/maximize
      // (Shortcut/PowerShell), clicking, typing, scrolling, screenshots,
      // paste (Clipboard) and app switching. Dropped: Move, Wait, Multi*,
      // FileSystem, Process, Registry, Scrape, Snapshot, Notification.
      const CORE_TOOLS = new Set([
        "Click",
        "Type",
        "Scroll",
        "Shortcut",
        "Screenshot",
        "PowerShell",
        "Clipboard",
        "App",
      ]);
      const filtered = all.filter((t) => CORE_TOOLS.has(t?.name));
      // If upstream renames tools we'd otherwise silently lose MCP; fall back
      // to the full list so the skill still works, just slower.
      this.tools = filtered.length > 0 ? filtered : all;
      this.available = this.tools.length > 0;

      debugLogger.info("[windows-mcp] ready", {
        totalTools: all.length,
        keptTools: this.tools.map((t) => t.name),
      });
      broadcastToWindows("windows-mcp-ready", {
        available: this.available,
        toolCount: this.tools.length,
      });
    } catch (err) {
      debugLogger.warn("[windows-mcp] start failed", { error: err?.message });
      this.available = false;
      await this._cleanupClient();
      broadcastToWindows("windows-mcp-ready", { available: false });
    } finally {
      this.starting = false;
    }
  }

  async executeIntent(intent) {
    if (!this.available || !this.client) {
      return { success: false, summary: "Windows 控制功能未就绪（缺 uv 或 MCP 未启动）" };
    }
    const text = (intent || "").trim();
    if (!text) return { success: false, summary: "没听清要做什么" };

    // Fast-path #0: "(在X里)?输入 TEXT" → Clipboard.set → focus switch → ctrl+v.
    // MCP's Type tool needs coordinates we don't have; clipboard round-trip is
    // the reliable alternative. XiaoZhi's chat window is focused at submit
    // time, so we always need to switch focus away before pasting:
    //   - explicit app name (e.g. "在notepad里") → App{switch}
    //   - "在当前窗口"/"这里"/no preamble      → alt+tab (previous window)
    const typeMatch = text.match(TYPE_TEXT_RE);
    if (typeMatch && !APP_LAUNCH_RE.test(text)) {
      const rawTarget = (typeMatch[1] || "").trim();
      const toType = typeMatch[2];
      const targetIsNamedApp = rawTarget && !CURRENT_WINDOW_RE.test(rawTarget);
      const focusPlan = targetIsNamedApp
        ? { kind: "app", name: normalizeAppName(rawTarget) }
        : { kind: "alt-tab" };
      debugLogger.info("[windows-mcp] fast-path type text", {
        target: rawTarget || "(current)",
        focusPlan: focusPlan.kind === "app" ? `App:${focusPlan.name}` : "alt+tab",
        length: toType.length,
        preview: toType.slice(0, 40),
      });
      const t0 = Date.now();
      try {
        // 1) Set clipboard (global, so ordering vs focus-switch doesn't matter).
        const setResult = await Promise.race([
          this.client.callTool({
            name: "Clipboard",
            arguments: { mode: "set", text: toType },
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Clipboard set timed out")), EXECUTE_TIMEOUT_MS)
          ),
        ]);
        if (setResult?.isError) {
          return {
            success: false,
            summary: `设置剪贴板失败：${this._extractText(setResult) || "unknown"}`,
          };
        }

        // 2) Switch focus away from XiaoZhi so ctrl+v lands on the right window.
        if (focusPlan.kind === "app") {
          const focus = await this._focusOrLaunch(focusPlan.name);
          if (!focus.ok) {
            return {
              success: false,
              summary: `无法聚焦/启动 ${focusPlan.name}：${focus.error || "unknown"}`,
            };
          }
          // _focusOrLaunch already waited after launch; quick extra settle on switch.
          if (focus.action === "switch") await new Promise((r) => setTimeout(r, 250));
        } else {
          const altTab = await Promise.race([
            this.client.callTool({
              name: "Shortcut",
              arguments: { shortcut: "alt+tab" },
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("alt+tab timed out")), EXECUTE_TIMEOUT_MS)
            ),
          ]);
          if (altTab?.isError) {
            debugLogger.warn("[windows-mcp] alt+tab reported error", {
              text: this._extractText(altTab),
            });
          }
          await new Promise((r) => setTimeout(r, 250));
        }

        // 4) Paste.
        const pasteResult = await Promise.race([
          this.client.callTool({
            name: "Shortcut",
            arguments: { shortcut: "ctrl+v" },
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Shortcut ctrl+v timed out")), EXECUTE_TIMEOUT_MS)
          ),
        ]);
        debugLogger.info("[windows-mcp] fast-path type done", {
          elapsedMs: Date.now() - t0,
          isError: Boolean(pasteResult?.isError),
        });
        return {
          success: !pasteResult?.isError,
          summary: pasteResult?.isError
            ? `粘贴失败：${this._extractText(pasteResult) || "unknown"}`
            : `已输入：${toType.slice(0, 40)}${toType.length > 40 ? "…" : ""}`,
          toolUsed: "Clipboard+Focus+Shortcut",
          toolArgs: { text: toType, focusPlan },
          fastPath: true,
          rawResult: pasteResult,
        };
      } catch (err) {
        debugLogger.warn("[windows-mcp] fast-path type failed", { error: err?.message });
        return { success: false, summary: `输入失败：${err?.message || "unknown"}` };
      }
    }

    // Fast-path #1: "打开/启动 XXX" → App{mode:'launch', name: normalized}
    // Translates Chinese display names to executable names so Windows-MCP's
    // launcher can find them ("记事本" → "notepad").
    const launchMatch = text.match(APP_LAUNCH_RE);
    if (launchMatch) {
      const rawName = launchMatch[1];
      const exeName = normalizeAppName(rawName);
      debugLogger.info("[windows-mcp] fast-path app launch", {
        raw: rawName,
        resolved: exeName,
      });
      const t0 = Date.now();
      try {
        const result = await Promise.race([
          this.client.callTool({
            name: "App",
            arguments: { mode: "launch", name: exeName },
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`MCP tool App timed out`)),
              EXECUTE_TIMEOUT_MS
            )
          ),
        ]);
        const resultText = this._extractText(result);
        debugLogger.info("[windows-mcp] fast-path app launch done", {
          elapsedMs: Date.now() - t0,
          isError: Boolean(result?.isError),
        });
        return {
          success: !result?.isError,
          summary: resultText || `已启动 ${exeName}`,
          toolUsed: "App",
          toolArgs: { mode: "launch", name: exeName },
          fastPath: true,
          rawResult: result,
        };
      } catch (err) {
        debugLogger.warn("[windows-mcp] fast-path app launch failed", {
          error: err?.message,
        });
        return { success: false, summary: `启动 ${rawName} 失败：${err?.message || "unknown"}` };
      }
    }

    // Fast-path #1.5: "notepad 全选" / "在chrome里复制" → App switch + shortcut.
    // Catches the targeted-edit form before the untargeted RULE_TABLE would
    // fire the shortcut at XiaoZhi's own window.
    const targetedEditMatch = text.match(TARGETED_EDIT_RE);
    if (targetedEditMatch) {
      const rawTarget = targetedEditMatch[1].trim();
      const verb = targetedEditMatch[2].trim().toLowerCase();
      const shortcut = EDIT_VERB_TO_SHORTCUT.get(verb);
      const isCurrent = CURRENT_WINDOW_RE.test(rawTarget);
      // Only engage if the target looks like an app (not "当前窗口") AND we
      // recognize the verb. Otherwise fall through to RULE_TABLE which
      // handles the bare-verb case against the current window.
      if (shortcut && !isCurrent && rawTarget.length <= 30) {
        const exeName = normalizeAppName(rawTarget);
        debugLogger.info("[windows-mcp] fast-path targeted edit", {
          target: rawTarget,
          resolved: exeName,
          shortcut,
        });
        const t0 = Date.now();
        try {
          const focus = await this._focusOrLaunch(exeName);
          if (!focus.ok) {
            debugLogger.warn("[windows-mcp] targeted edit focus failed", {
              error: focus.error,
            });
            return {
              success: false,
              summary: `无法聚焦/启动 ${rawTarget}：${focus.error || "unknown"}`,
            };
          }
          if (focus.action === "switch") await new Promise((r) => setTimeout(r, 250));
          const shortcutResult = await Promise.race([
            this.client.callTool({
              name: "Shortcut",
              arguments: { shortcut },
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Shortcut timed out")), EXECUTE_TIMEOUT_MS)
            ),
          ]);
          debugLogger.info("[windows-mcp] fast-path targeted edit done", {
            elapsedMs: Date.now() - t0,
            isError: Boolean(shortcutResult?.isError),
          });
          return {
            success: !shortcutResult?.isError,
            summary: shortcutResult?.isError
              ? `${verb} 失败：${this._extractText(shortcutResult) || "unknown"}`
              : `已在 ${rawTarget} 执行 ${verb}`,
            toolUsed: "App+Shortcut",
            toolArgs: { target: exeName, shortcut },
            fastPath: true,
            rawResult: shortcutResult,
          };
        } catch (err) {
          debugLogger.warn("[windows-mcp] fast-path targeted edit failed", {
            error: err?.message,
          });
          return { success: false, summary: `${verb} 失败：${err?.message || "unknown"}` };
        }
      }
    }

    // Fast-path #2: regex rule match → direct MCP call, skip LLM entirely.
    for (const rule of RULE_TABLE) {
      if (rule.re.test(text)) {
        debugLogger.info("[windows-mcp] fast-path rule hit", {
          pattern: rule.re.source,
          tool: rule.tool,
          args: rule.args,
        });
        const t0 = Date.now();
        try {
          const result = await Promise.race([
            this.client.callTool({ name: rule.tool, arguments: rule.args }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`MCP tool ${rule.tool} timed out`)),
                EXECUTE_TIMEOUT_MS
              )
            ),
          ]);
          const resultText = this._extractText(result);
          debugLogger.info("[windows-mcp] fast-path done", {
            elapsedMs: Date.now() - t0,
            isError: Boolean(result?.isError),
          });
          return {
            success: !result?.isError,
            summary: resultText || `已执行 ${rule.tool}`,
            toolUsed: rule.tool,
            toolArgs: rule.args,
            fastPath: true,
            rawResult: result,
          };
        } catch (err) {
          debugLogger.warn("[windows-mcp] fast-path tool failed", {
            tool: rule.tool,
            error: err?.message,
          });
          return { success: false, summary: `执行 ${rule.tool} 失败：${err?.message || "unknown"}` };
        }
      }
    }

    const llamaPort = this.getLlamaPort();
    if (!llamaPort) {
      return { success: false, summary: "本地模型未启动，无法规划工具调用" };
    }

    const openAiTools = this._toolsAsOpenAi();
    // Qwen3 defaults to thinking=on, which burned the 512-token budget on a
    // <think> block and truncated the tool-call arguments to `{"` in testing.
    // `/no_think` is the Qwen3-native opt-out; chat_template_kwargs is the
    // llama.cpp / HF wire for the same thing. We send both as belt-and-braces
    // and bump max_tokens so an occasional stray <think> fragment doesn't
    // kill the JSON.
    const payload = {
      model: "local",
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT} /no_think` },
        { role: "user", content: `${text} /no_think` },
      ],
      tools: openAiTools,
      tool_choice: "auto",
      temperature: 0.2,
      // Tool calls need ~30–100 output tokens. 1024 reserved too much of the
      // 8192 ctx window and collided with cached router prompts → HTTP 500
      // "Context size has been exceeded". 256 is ample and leaves headroom.
      max_tokens: 256,
      chat_template_kwargs: { enable_thinking: false },
    };

    const promptChars = JSON.stringify(openAiTools).length + SYSTEM_PROMPT.length + text.length;
    debugLogger.info("[windows-mcp] planning tool call", {
      intent: text,
      toolCount: openAiTools.length,
      approxPromptChars: promptChars,
    });

    let completion;
    const t0 = Date.now();
    try {
      completion = await Promise.race([
        this._postJson(`http://127.0.0.1:${llamaPort}/v1/chat/completions`, payload),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`local LLM timed out after ${EXECUTE_TIMEOUT_MS}ms`)),
            EXECUTE_TIMEOUT_MS
          )
        ),
      ]);
      debugLogger.info("[windows-mcp] planning returned", { elapsedMs: Date.now() - t0 });
    } catch (err) {
      debugLogger.warn("[windows-mcp] LLM call failed", { error: err?.message });
      return { success: false, summary: `规划失败：${err?.message || "unknown"}` };
    }

    const message = completion?.choices?.[0]?.message;
    const toolCall = Array.isArray(message?.tool_calls) ? message.tool_calls[0] : null;

    if (!toolCall) {
      const fallback = (message?.content || "").trim() || "没找到合适的操作";
      return { success: false, summary: fallback };
    }

    const toolName = toolCall.function?.name;
    let toolArgs = {};
    try {
      const raw = toolCall.function?.arguments;
      toolArgs = raw ? JSON.parse(raw) : {};
    } catch (err) {
      debugLogger.warn("[windows-mcp] bad tool args JSON", {
        error: err?.message,
        raw: toolCall.function?.arguments,
      });
      return { success: false, summary: "工具参数解析失败" };
    }

    debugLogger.info("[windows-mcp] calling tool", { toolName, toolArgs });

    let result;
    try {
      result = await Promise.race([
        this.client.callTool({ name: toolName, arguments: toolArgs }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`MCP tool ${toolName} timed out`)),
            EXECUTE_TIMEOUT_MS
          )
        ),
      ]);
    } catch (err) {
      debugLogger.warn("[windows-mcp] tool call failed", {
        toolName,
        error: err?.message,
      });
      return { success: false, summary: `执行 ${toolName} 失败：${err?.message || "unknown"}` };
    }

    const resultText = this._extractText(result);
    const summary = resultText || `已执行 ${toolName}`;

    return {
      success: !result?.isError,
      summary,
      toolUsed: toolName,
      toolArgs,
      rawResult: result,
    };
  }

  async stop() {
    debugLogger.debug("[windows-mcp] stopping");
    this.available = false;
    await this._cleanupClient();
  }

  async _cleanupClient() {
    try {
      if (this.client) await this.client.close();
    } catch {
      // best effort
    }
    try {
      if (this.transport) await this.transport.close();
    } catch {
      // best effort
    }
    this.client = null;
    this.transport = null;
    this.tools = [];
  }

  _toolsAsOpenAi() {
    return this.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.inputSchema || { type: "object", properties: {} },
      },
    }));
  }

  // Try App{switch}; if the window isn't open, fall back to App{launch} and
  // give it ~1.2s to settle. Returns `{ ok, action, error? }`.
  //
  // Note: Windows-MCP's App tool returns plain strings on failure instead of
  // setting isError, so we also have to text-match error signatures.
  async _focusOrLaunch(exeName) {
    try {
      const switchResult = await Promise.race([
        this.client.callTool({
          name: "App",
          arguments: { mode: "switch", name: exeName },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("App switch timed out")), EXECUTE_TIMEOUT_MS)
        ),
      ]);
      const switchText = this._extractText(switchResult);
      const switchLooksFailed =
        switchResult?.isError ||
        /not found|no windows|failed to get desktop/i.test(switchText);
      if (!switchLooksFailed) {
        return { ok: true, action: "switch" };
      }
      debugLogger.info("[windows-mcp] switch miss, launching", {
        name: exeName,
        switchText,
      });
    } catch (err) {
      debugLogger.warn("[windows-mcp] switch threw, launching", {
        name: exeName,
        error: err?.message,
      });
    }
    try {
      const launchResult = await Promise.race([
        this.client.callTool({
          name: "App",
          arguments: { mode: "launch", name: exeName },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("App launch timed out")), EXECUTE_TIMEOUT_MS)
        ),
      ]);
      const launchText = this._extractText(launchResult);
      // Same text-matching game as switch — launch_app returns status-string
      // on failure (e.g. "not found in start menu", "Invalid app identifier").
      const launchLooksFailed =
        launchResult?.isError ||
        /not found|invalid app/i.test(launchText);
      if (launchLooksFailed) {
        return { ok: false, action: "launch", error: launchText };
      }
      // Give the new window time to come up + grab focus.
      await new Promise((r) => setTimeout(r, 1200));
      return { ok: true, action: "launch" };
    } catch (err) {
      return { ok: false, action: "launch", error: err?.message };
    }
  }

  _extractText(toolResult) {
    const content = toolResult?.content;
    if (!Array.isArray(content)) return "";
    const texts = content
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text.trim())
      .filter(Boolean);
    return texts.join("\n").slice(0, 600);
  }

  _postJson(url, body) {
    return new Promise((resolve, reject) => {
      const data = Buffer.from(JSON.stringify(body), "utf-8");
      const parsed = new URL(url);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(data.length),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks).toString("utf-8");
            if (res.statusCode && res.statusCode >= 400) {
              return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
            }
            try {
              resolve(JSON.parse(buf));
            } catch (err) {
              reject(new Error(`bad JSON from LLM: ${err.message}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }
}

module.exports = WindowsMcpManager;
