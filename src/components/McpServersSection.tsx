import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Trash2,
  Plug,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import { SettingsPanel, SettingsPanelRow } from "./ui/SettingsSection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type Tool = { name: string; description?: string; inputSchema?: unknown };

type ServerRow = {
  id: number;
  name: string;
  transport: "stdio" | "http";
  config_json: string;
  enabled: boolean;
  status: string;
  last_error: string | null;
  runtimeStatus: "connected" | "disconnected" | "error";
  toolCount: number;
  tools: Tool[];
};

const SAMPLE_CONFIG = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/you"]
    },
    "context7": {
      "url": "https://mcp.context7.com/mcp"
    }
  }
}`;

export default function McpServersSection() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [pasted, setPasted] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addResults, setAddResults] = useState<
    Array<{ name: string; status: string; error?: string; toolCount?: number }>
  >([]);

  const refresh = useCallback(async () => {
    try {
      const list = (await window.electronAPI?.mcpListServers?.()) ?? [];
      setServers(list as ServerRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = useCallback(async () => {
    if (!pasted.trim()) {
      setAddError(t("integrations.mcp.emptyPasteError"));
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await window.electronAPI?.mcpAddServer?.(pasted);
      if (!res?.success) {
        setAddError(res?.error || t("integrations.mcp.unknownError"));
        setAddResults([]);
      } else {
        setAddResults(res.results ?? []);
        setPasted("");
        await refresh();
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }, [pasted, refresh, t]);

  const handleRemove = useCallback(
    async (name: string) => {
      setBusy(name);
      try {
        await window.electronAPI?.mcpRemoveServer?.(name);
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const handleToggle = useCallback(
    async (name: string, enabled: boolean) => {
      setBusy(name);
      try {
        await window.electronAPI?.mcpSetServerEnabled?.(name, enabled);
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const handleTest = useCallback(
    async (name: string) => {
      setBusy(name);
      try {
        await window.electronAPI?.mcpTestServer?.(name);
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const toggleExpand = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleCloseAdd = useCallback((open: boolean) => {
    setShowAdd(open);
    if (!open) {
      setPasted("");
      setAddError(null);
      setAddResults([]);
    }
  }, []);

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">{t("integrations.mcp.title")}</h3>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("integrations.mcp.add")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground/70 mb-3">{t("integrations.mcp.description")}</p>

        <SettingsPanel>
          {loading && (
            <SettingsPanelRow>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("integrations.mcp.loading")}
              </div>
            </SettingsPanelRow>
          )}

          {!loading && servers.length === 0 && (
            <SettingsPanelRow>
              <p className="text-xs text-muted-foreground/70">{t("integrations.mcp.empty")}</p>
            </SettingsPanelRow>
          )}

          {servers.map((s) => {
            const isExpanded = expanded.has(s.name);
            const isConnected = s.runtimeStatus === "connected";
            const hasError = s.runtimeStatus === "error" || !!s.last_error;
            return (
              <SettingsPanelRow key={s.name}>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleExpand(s.name)}
                      className="p-0.5 -ml-0.5 rounded hover:bg-foreground/5"
                      aria-label="toggle"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                    <span className="text-xs font-semibold text-foreground">{s.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                      {s.transport}
                    </Badge>
                    {isConnected && (
                      <Badge variant="success" className="text-[10px] px-1.5 py-0 font-normal">
                        <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                        {t("integrations.mcp.connected", { count: s.toolCount })}
                      </Badge>
                    )}
                    {hasError && !isConnected && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 font-normal text-destructive border-destructive/40"
                      >
                        <AlertCircle className="h-2.5 w-2.5 mr-1" />
                        {t("integrations.mcp.error")}
                      </Badge>
                    )}
                    {!s.enabled && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                        {t("integrations.mcp.disabled")}
                      </Badge>
                    )}
                    <div className="flex-1" />
                    <button
                      onClick={() => handleToggle(s.name, !s.enabled)}
                      disabled={busy === s.name}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {s.enabled ? t("integrations.mcp.disable") : t("integrations.mcp.enable")}
                    </button>
                    {s.enabled && (
                      <button
                        onClick={() => handleTest(s.name)}
                        disabled={busy === s.name}
                        className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                        aria-label={t("integrations.mcp.reconnect")}
                        title={t("integrations.mcp.reconnect")}
                      >
                        {busy === s.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plug className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(s.name)}
                      disabled={busy === s.name}
                      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                      aria-label={t("integrations.mcp.remove")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {hasError && s.last_error && (
                    <p className="text-[11px] text-destructive/80 pl-5 break-all">{s.last_error}</p>
                  )}

                  {isExpanded && (
                    <div className="pl-5 pt-1 space-y-1">
                      {s.tools.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground/60">
                          {isConnected
                            ? t("integrations.mcp.noTools")
                            : t("integrations.mcp.connectToSeeTools")}
                        </p>
                      ) : (
                        s.tools.map((tool) => (
                          <div key={tool.name} className="text-[11px]">
                            <code className="text-foreground/80">{tool.name}</code>
                            {tool.description && (
                              <span className="text-muted-foreground/60 ml-2">
                                — {tool.description}
                              </span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </SettingsPanelRow>
            );
          })}
        </SettingsPanel>
      </div>

      <Dialog open={showAdd} onOpenChange={handleCloseAdd}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("integrations.mcp.addTitle")}</DialogTitle>
            <DialogDescription>{t("integrations.mcp.addDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={SAMPLE_CONFIG}
              rows={10}
              className="font-mono text-xs"
              spellCheck={false}
            />
            {addError && (
              <p className="text-xs text-destructive flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-all">{addError}</span>
              </p>
            )}
            {addResults.length > 0 && (
              <div className="space-y-1 text-xs">
                {addResults.map((r) => (
                  <div key={r.name} className="flex items-center gap-2">
                    {r.status === "connected" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                    )}
                    <span className="font-mono">{r.name}</span>
                    <span className="text-muted-foreground/70">
                      {r.status === "connected"
                        ? t("integrations.mcp.connected", { count: r.toolCount ?? 0 })
                        : r.error || r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => handleCloseAdd(false)} disabled={adding}>
              {t("common.close")}
            </Button>
            <Button onClick={handleAdd} disabled={adding}>
              {adding && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {t("integrations.mcp.saveAndConnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
