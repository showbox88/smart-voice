import { useCallback, useEffect, useState } from "react";
import {
  Plug,
  Power,
  RefreshCw,
  LogIn,
  LogOut,
  Loader2,
  AlertCircle,
  Music,
  FolderOpen,
  Play,
  Square,
  UploadCloud,
  CheckCircle2,
  Globe,
  Save,
  Mic,
  Download,
} from "lucide-react";
import { cn } from "./lib/utils";

type Device = {
  cid: string;
  uuid: string | null;
  name: string;
  type: string;
  category: string;
  status: string;
  online: boolean;
  mac: string | null;
  region: string | null;
};

export default function SmartHomeView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [togglingCid, setTogglingCid] = useState<string | null>(null);

  // Music state
  const [musicFolder, setMusicFolder] = useState("");
  const [vlcAvailable, setVlcAvailable] = useState(false);
  const [vlcPath, setVlcPath] = useState<string | null>(null);
  const [trackCount, setTrackCount] = useState<number | null>(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicError, setMusicError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [importReport, setImportReport] = useState<{
    copied: number;
    skipped: number;
  } | null>(null);

  // Tavily (web search) state
  const [tavilyKey, setTavilyKey] = useState("");
  const [tavilySaved, setTavilySaved] = useState(false);
  const [tavilyBusy, setTavilyBusy] = useState(false);
  const [tavilyEnabled, setTavilyEnabled] = useState(true);
  const [tavilyCap, setTavilyCap] = useState(1000);
  const [tavilyUsage, setTavilyUsage] = useState<{ month: string; count: number } | null>(null);

  // Wake-word state
  const [wwEnabled, setWwEnabled] = useState(false);
  const [wwPresetId, setWwPresetId] = useState("xiaozhi");
  const [wwThreshold, setWwThreshold] = useState(1.5);
  const [wwPresets, setWwPresets] = useState<Array<{ id: string; display: string }>>([]);
  const [wwModelDownloaded, setWwModelDownloaded] = useState(false);
  const [wwDownloading, setWwDownloading] = useState(false);
  const [wwDownloadPct, setWwDownloadPct] = useState(0);
  const [wwRunning, setWwRunning] = useState(false);
  const [wwError, setWwError] = useState<string | null>(null);

  // Load saved credentials on mount
  useEffect(() => {
    (async () => {
      const [e, p, c, tk, tEnabled, tCap, tUsage] = await Promise.all([
        window.electronAPI?.getVeSyncEmail?.() ?? "",
        window.electronAPI?.getVeSyncPassword?.() ?? "",
        window.electronAPI?.getVeSyncCountryCode?.() ?? "US",
        window.electronAPI?.getTavilyKey?.() ?? "",
        window.electronAPI?.getTavilyEnabled?.() ?? true,
        window.electronAPI?.getTavilyCap?.() ?? 1000,
        window.electronAPI?.getTavilyUsage?.(),
      ]);
      setEmail(e || "");
      setPassword(p || "");
      setCountryCode(c || "US");
      setTavilyKey(tk || "");
      setTavilyEnabled(tEnabled !== false);
      setTavilyCap(typeof tCap === "number" ? tCap : 1000);
      if (tUsage) setTavilyUsage({ month: tUsage.month, count: tUsage.count });

      try {
        const [wwSettings, wwStatus, presets] = await Promise.all([
          window.electronAPI?.wakeWord?.getSettings?.(),
          window.electronAPI?.wakeWord?.getStatus?.(),
          window.electronAPI?.wakeWord?.getPresets?.(),
        ]);
        if (wwSettings) {
          setWwEnabled(Boolean(wwSettings.enabled));
          setWwPresetId(wwSettings.presetId || "xiaozhi");
          setWwThreshold(
            Number.isFinite(wwSettings.threshold) ? Number(wwSettings.threshold) : 1.5
          );
        }
        if (wwStatus) {
          setWwModelDownloaded(Boolean(wwStatus.modelDownloaded));
          setWwRunning(Boolean(wwStatus.running));
          setWwDownloading(Boolean(wwStatus.downloading));
          setWwError(wwStatus.error || null);
        }
        if (Array.isArray(presets)) setWwPresets(presets);
      } catch {
        // ignore
      }

      // If we already have credentials, try a silent login + fetch
      if (e && p) {
        const r = await window.electronAPI?.vesyncLogin?.({});
        if (r?.success) {
          setLoggedIn(true);
          fetchDevices();
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshMusicStatus = useCallback(async (folder: string) => {
    const vlc = await window.electronAPI?.musicVlcStatus?.();
    setVlcAvailable(Boolean(vlc?.available));
    setVlcPath(vlc?.path || null);
    if (folder) {
      const r = await window.electronAPI?.musicList?.({ root: folder });
      if (r?.success) {
        setTrackCount(r.files?.length || 0);
        setMusicError("");
      } else if (r?.error === "root_not_found") {
        setTrackCount(null);
        setMusicError("文件夹不存在");
      } else {
        setTrackCount(null);
      }
    } else {
      setTrackCount(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const f = (await window.electronAPI?.getMusicFolder?.()) || "";
      setMusicFolder(f);
      await refreshMusicStatus(f);
    })();
  }, [refreshMusicStatus]);

  // Chromium navigates to dropped files by default — suppress it globally
  // while this view is mounted so our drop zone can actually receive them.
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const handlePickMusicFolder = useCallback(async () => {
    const r = await window.electronAPI?.musicPickFolder?.();
    if (!r?.success || !r.folder) return;
    setMusicBusy(true);
    setMusicError("");
    await window.electronAPI?.saveMusicFolder?.(r.folder);
    setMusicFolder(r.folder);
    await refreshMusicStatus(r.folder);
    setMusicBusy(false);
  }, [refreshMusicStatus]);

  const handleRescanMusic = useCallback(async () => {
    if (!musicFolder) return;
    setMusicBusy(true);
    setMusicError("");
    const r = await window.electronAPI?.musicList?.({ root: musicFolder, refresh: true });
    if (r?.success) {
      setTrackCount(r.files?.length || 0);
    } else {
      setMusicError(r?.error || "扫描失败");
    }
    setMusicBusy(false);
  }, [musicFolder]);

  const handleTestPlay = useCallback(async () => {
    if (!musicFolder) return;
    setMusicBusy(true);
    setMusicError("");
    const r = await window.electronAPI?.musicList?.({ root: musicFolder });
    if (!r?.success || !r.files?.length) {
      setMusicError("文件夹里没有音频文件");
      setMusicBusy(false);
      return;
    }
    const pick = r.files[Math.floor(Math.random() * r.files.length)];
    const play = await window.electronAPI?.musicPlay?.([pick]);
    if (!play?.success) {
      setMusicError(play?.error || "播放失败");
    }
    setMusicBusy(false);
  }, [musicFolder]);

  const handleStopMusic = useCallback(async () => {
    await window.electronAPI?.musicStop?.();
  }, []);

  const handleSaveTavily = useCallback(async () => {
    setTavilyBusy(true);
    try {
      await Promise.all([
        window.electronAPI?.saveTavilyKey?.(tavilyKey.trim()),
        window.electronAPI?.saveTavilyCap?.(tavilyCap),
      ]);
      setTavilySaved(true);
      setTimeout(() => setTavilySaved(false), 1800);
    } finally {
      setTavilyBusy(false);
    }
  }, [tavilyKey, tavilyCap]);

  const handleToggleTavily = useCallback(
    async (enabled: boolean) => {
      setTavilyEnabled(enabled);
      await window.electronAPI?.saveTavilyEnabled?.(enabled);
    },
    []
  );

  const refreshTavilyUsage = useCallback(async () => {
    const u = await window.electronAPI?.getTavilyUsage?.();
    if (u) setTavilyUsage({ month: u.month, count: u.count });
  }, []);

  // Wake-word — live status & download progress subscriptions
  useEffect(() => {
    const offStatus = window.electronAPI?.wakeWord?.onStatusChange?.((status: any) => {
      if (!status) return;
      setWwModelDownloaded(Boolean(status.modelDownloaded));
      setWwRunning(Boolean(status.running));
      setWwDownloading(Boolean(status.downloading));
      setWwError(status.error || null);
    });
    const offProgress = window.electronAPI?.wakeWord?.onDownloadProgress?.((p: any) => {
      if (!p) return;
      if (p.phase === "downloading") {
        setWwDownloading(true);
        setWwDownloadPct(Math.round((p.progress || 0) * 100));
      } else if (p.phase === "extracting") {
        setWwDownloading(true);
        setWwDownloadPct(100);
      } else if (p.phase === "done") {
        setWwDownloading(false);
        setWwDownloadPct(0);
      }
    });
    return () => {
      try {
        offStatus?.();
      } catch {
        // ignore
      }
      try {
        offProgress?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const applyWakeWordConfig = useCallback(
    async (enabled: boolean, presetId: string, threshold: number) => {
      await window.electronAPI?.wakeWord?.saveSettings?.({ enabled, presetId, threshold });
      if (enabled) {
        if (!wwModelDownloaded) return;
        await window.electronAPI?.wakeWord?.restart?.({ presetId, threshold });
      } else {
        await window.electronAPI?.wakeWord?.stop?.();
      }
    },
    [wwModelDownloaded]
  );

  const handleToggleWakeWord = useCallback(
    async (enabled: boolean) => {
      setWwError(null);
      setWwEnabled(enabled);
      if (enabled && !wwModelDownloaded) {
        // Need to download first; enable persists but actual start waits for download.
        await window.electronAPI?.wakeWord?.saveSettings?.({ enabled: true });
        setWwDownloading(true);
        const r = await window.electronAPI?.wakeWord?.downloadModel?.();
        if (!r?.success) {
          setWwError(r?.error || "下载失败");
          setWwDownloading(false);
          setWwEnabled(false);
          await window.electronAPI?.wakeWord?.saveSettings?.({ enabled: false });
          return;
        }
        setWwModelDownloaded(true);
        setWwDownloading(false);
        const startRes = await window.electronAPI?.wakeWord?.start?.({
          presetId: wwPresetId,
          threshold: wwThreshold,
        });
        if (!startRes?.success) setWwError(startRes?.error || "启动失败");
        return;
      }
      await applyWakeWordConfig(enabled, wwPresetId, wwThreshold);
    },
    [wwModelDownloaded, wwPresetId, wwThreshold, applyWakeWordConfig]
  );

  const handleChangeWakeWordPreset = useCallback(
    async (presetId: string) => {
      setWwPresetId(presetId);
      if (wwEnabled) {
        await applyWakeWordConfig(true, presetId, wwThreshold);
      } else {
        await window.electronAPI?.wakeWord?.saveSettings?.({ presetId });
      }
    },
    [wwEnabled, wwThreshold, applyWakeWordConfig]
  );

  const handleChangeWakeWordThreshold = useCallback(
    async (threshold: number) => {
      setWwThreshold(threshold);
      if (wwEnabled) {
        await applyWakeWordConfig(true, wwPresetId, threshold);
      } else {
        await window.electronAPI?.wakeWord?.saveSettings?.({ threshold });
      }
    },
    [wwEnabled, wwPresetId, applyWakeWordConfig]
  );

  const importDroppedFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!musicFolder) {
        setMusicError("请先选择音乐文件夹");
        return;
      }
      const list = Array.from(files);
      if (list.length === 0) return;
      const paths = list
        .map((f) => {
          try {
            return window.electronAPI?.getPathForFile?.(f) || "";
          } catch {
            return "";
          }
        })
        .filter(Boolean);
      if (paths.length === 0) {
        setMusicError("无法读取文件路径");
        return;
      }
      setMusicBusy(true);
      setMusicError("");
      setImportReport(null);
      const r = await window.electronAPI?.musicImportPaths?.(paths);
      if (r?.success) {
        setImportReport({
          copied: r.copied?.length || 0,
          skipped: r.skipped?.length || 0,
        });
        await refreshMusicStatus(musicFolder);
      } else {
        setMusicError(r?.error || "导入失败");
      }
      setMusicBusy(false);
    },
    [musicFolder, refreshMusicStatus]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropActive(false);
      if (e.dataTransfer?.files?.length) {
        importDroppedFiles(e.dataTransfer.files);
      }
    },
    [importDroppedFiles]
  );

  const fetchDevices = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const r = await window.electronAPI?.vesyncListDevices?.({ refresh: true });
      if (r?.success) {
        setDevices(r.devices);
        setLoggedIn(true);
      } else {
        setError(r?.error || "无法获取设备列表");
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleLogin = useCallback(async () => {
    if (!email.trim() || !password) {
      setError("请填写邮箱和密码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await Promise.all([
        window.electronAPI?.saveVeSyncEmail?.(email.trim()),
        window.electronAPI?.saveVeSyncPassword?.(password),
        window.electronAPI?.saveVeSyncCountryCode?.(countryCode || "US"),
      ]);
      const r = await window.electronAPI?.vesyncLogin?.({ force: true });
      if (!r?.success) {
        const msg =
          r?.error === "credential_error"
            ? "邮箱或密码错误"
            : r?.error === "region_mismatch"
              ? "账号所在区域和国家代码不匹配 —— 换个国家再试"
              : r?.error === "login_rejected"
                ? "登录被拒绝（具体原因见下方）"
                : r?.error || "登录失败";
        setError(msg);
        setErrorDetails((r as { logs?: string[] })?.logs || []);
        setBusy(false);
        return;
      }
      setErrorDetails([]);
      setLoggedIn(true);
      await fetchDevices();
    } catch (e: any) {
      setError(e?.message || String(e));
      setBusy(false);
    }
  }, [email, password, countryCode, fetchDevices]);

  const handleLogout = useCallback(async () => {
    await window.electronAPI?.vesyncLogout?.();
    setLoggedIn(false);
    setDevices([]);
  }, []);

  const handleToggle = useCallback(
    async (dev: Device) => {
      if (!dev.online) {
        setError(`设备「${dev.name}」离线`);
        return;
      }
      setTogglingCid(dev.cid);
      setError("");
      const desired: "on" | "off" = dev.status === "on" ? "off" : "on";
      // Optimistic flip
      setDevices((prev) =>
        prev.map((d) => (d.cid === dev.cid ? { ...d, status: desired } : d))
      );
      const r = await window.electronAPI?.vesyncToggle?.(dev.cid, desired);
      if (!r?.success) {
        // Revert on failure
        setDevices((prev) =>
          prev.map((d) => (d.cid === dev.cid ? { ...d, status: dev.status } : d))
        );
        setError(r?.error || `切换「${dev.name}」失败`);
      } else if (r.status) {
        setDevices((prev) =>
          prev.map((d) => (d.cid === dev.cid ? { ...d, status: r.status! } : d))
        );
      }
      setTogglingCid(null);
    },
    []
  );

  if (!loggedIn) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm space-y-4">
          <div className="flex items-center gap-2 text-foreground">
            <Plug size={18} />
            <h2 className="text-base font-medium">VeSync 登录</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            输入 VeSync App 的账号 —— 我们用云 API 拉取你已经配对的设备。
          </p>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground block">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full text-sm bg-background border border-border/50 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground block">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              className="w-full text-sm bg-background border border-border/50 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground block">
              国家/区域（决定使用 US 还是 EU 服务器）
            </label>
            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              style={{ colorScheme: "dark light" }}
              className="w-full text-sm text-foreground bg-background border border-border/50 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="US">美国 (US 节点)</option>
              <option value="CA">加拿大 (US 节点)</option>
              <option value="MX">墨西哥 (US 节点)</option>
              <option value="JP">日本 (US 节点)</option>
              <option value="CN">中国 (EU 节点)</option>
              <option value="HK">香港 (EU 节点)</option>
              <option value="TW">台湾 (EU 节点)</option>
              <option value="SG">新加坡 (EU 节点)</option>
              <option value="GB">英国 (EU 节点)</option>
              <option value="DE">德国 (EU 节点)</option>
              <option value="FR">法国 (EU 节点)</option>
              <option value="AU">澳大利亚 (EU 节点)</option>
              <option value="NZ">新西兰 (EU 节点)</option>
            </select>
          </div>

          {error && (
            <div className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-md p-2 space-y-1.5">
              <div className="flex items-start gap-2">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
              {errorDetails.length > 0 && (
                <details className="text-[10px] font-mono opacity-70 pl-5">
                  <summary className="cursor-pointer">详细日志（来自 VeSync 服务器）</summary>
                  <div className="mt-1 space-y-0.5 max-h-40 overflow-auto">
                    {errorDetails.map((line, i) => (
                      <div key={i} className="break-words">
                        {line}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
            登录 VeSync
          </button>

          <p className="text-[10px] text-muted-foreground/60 leading-snug pt-2">
            注：邮箱和密码以明文形式保存在本地 .env 中（与 OpenAI/Anthropic 等 Key 同样方式）。
            登录成功后会自动获取你账号下的所有设备。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/20">
        <Plug size={16} className="text-primary" />
        <h2 className="text-sm font-medium flex-1">智能家居（VeSync）</h2>
        <span className="text-[11px] text-muted-foreground">{email}</span>
        <button
          onClick={fetchDevices}
          disabled={busy}
          title="刷新"
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-border/50 hover:bg-foreground/5 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          刷新
        </button>
        <button
          onClick={handleLogout}
          title="退出"
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-border/50 hover:bg-foreground/5"
        >
          <LogOut size={12} />
          退出
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 text-[11px] text-destructive border-b border-destructive/30 bg-destructive/5 flex items-start gap-2">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Device list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {busy && devices.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin mr-2" /> 正在获取设备…
          </div>
        ) : devices.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            账号下没有设备。先用 VeSync App 配好设备再回来刷新。
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {devices.map((d) => {
              const isOn = d.status === "on";
              const isToggling = togglingCid === d.cid;
              return (
                <div
                  key={d.cid}
                  className={cn(
                    "rounded-lg border p-4 space-y-2 transition-colors",
                    !d.online && "opacity-50",
                    isOn
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/40 bg-foreground/2"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{d.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {d.type}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full shrink-0",
                        d.online
                          ? "bg-green-500/15 text-green-600 dark:text-green-400"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {d.online ? "在线" : "离线"}
                    </span>
                  </div>

                  <button
                    onClick={() => handleToggle(d)}
                    disabled={!d.online || isToggling}
                    className={cn(
                      "w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-md text-sm font-medium transition-colors disabled:opacity-40",
                      isOn
                        ? "bg-primary text-primary-foreground hover:opacity-90"
                        : "border border-border/50 hover:bg-foreground/5"
                    )}
                  >
                    {isToggling ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Power size={13} />
                    )}
                    {isOn ? "开" : "关"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Music section */}
        <div className="mt-8 pt-6 border-t border-border/20">
          <div className="flex items-center gap-2 mb-3">
            <Music size={14} className="text-primary" />
            <h3 className="text-sm font-medium">音乐播放（VLC）</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            指定一个音乐文件夹，Agent 就能通过语音播放里面的曲目（递归扫描子文件夹）。播放走本机 VLC 窗口。
          </p>

          <div className="space-y-3 max-w-2xl">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">音乐文件夹</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={musicFolder}
                  readOnly
                  placeholder="（未设置）"
                  className="flex-1 text-sm bg-background border border-border/50 rounded-md px-3 py-2 font-mono text-xs"
                />
                <button
                  onClick={handlePickMusicFolder}
                  disabled={musicBusy}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-border/50 hover:bg-foreground/5 disabled:opacity-40"
                >
                  <FolderOpen size={12} />
                  选择
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full",
                    vlcAvailable ? "bg-green-500" : "bg-muted-foreground/40"
                  )}
                />
                VLC: {vlcAvailable ? "已检测到" : "未找到"}
                {vlcPath && (
                  <span className="font-mono text-[10px] opacity-60 ml-1 truncate max-w-60">
                    {vlcPath}
                  </span>
                )}
              </div>
              {trackCount !== null && <span>· {trackCount} 首曲目</span>}
            </div>

            {/* Drop zone — drag audio files here to copy into the folder */}
            <div
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "relative rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors",
                dropActive
                  ? "border-primary bg-primary/5"
                  : "border-border/40 hover:border-border/60",
                !musicFolder && "opacity-50 pointer-events-none"
              )}
            >
              <UploadCloud
                size={20}
                className={cn(
                  "mx-auto mb-1.5",
                  dropActive ? "text-primary" : "text-muted-foreground"
                )}
              />
              <div className="text-xs">
                {musicBusy ? (
                  <span className="text-muted-foreground inline-flex items-center gap-1.5">
                    <Loader2 size={11} className="animate-spin" /> 导入中…
                  </span>
                ) : dropActive ? (
                  <span className="text-primary font-medium">松开鼠标导入到音乐文件夹</span>
                ) : (
                  <span className="text-muted-foreground">
                    拖放 MP3 / FLAC / WAV 等音频文件到此处导入
                  </span>
                )}
              </div>
              {!musicFolder && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  请先选择音乐文件夹
                </div>
              )}
            </div>

            {importReport && (
              <div className="text-xs text-green-700 dark:text-green-400 border border-green-500/30 bg-green-500/5 rounded-md p-2 flex items-start gap-2">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                <span>
                  已导入 {importReport.copied} 个文件
                  {importReport.skipped > 0 && `（跳过 ${importReport.skipped} 个非音频/无效文件）`}
                </span>
              </div>
            )}

            {musicError && (
              <div className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-md p-2 flex items-start gap-2">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{musicError}</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleRescanMusic}
                disabled={!musicFolder || musicBusy}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-border/50 hover:bg-foreground/5 disabled:opacity-40"
              >
                {musicBusy ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                重新扫描
              </button>
              <button
                onClick={handleTestPlay}
                disabled={!musicFolder || !vlcAvailable || musicBusy}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-border/50 hover:bg-foreground/5 disabled:opacity-40"
              >
                <Play size={12} />
                测试播放（随机）
              </button>
              <button
                onClick={handleStopMusic}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-border/50 hover:bg-foreground/5"
              >
                <Square size={12} />
                停止
              </button>
            </div>

            {!vlcAvailable && (
              <p className="text-[11px] text-muted-foreground/80 leading-snug">
                VLC 未检测到。常见路径：<span className="font-mono">C:\Program Files\VideoLAN\VLC\vlc.exe</span>。
                装好后重启应用即可；也可以把路径写入 .env 的 <span className="font-mono">VLC_PATH</span>。
              </p>
            )}
          </div>
        </div>

        {/* Web search (Tavily) section */}
        <div className="mt-8 pt-6 border-t border-border/20">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-primary" />
            <h3 className="text-sm font-medium flex-1">网页搜索（Tavily）</h3>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs text-muted-foreground">
                {tavilyEnabled ? "已启用" : "已关闭"}
              </span>
              <input
                type="checkbox"
                checked={tavilyEnabled}
                onChange={(e) => handleToggleTavily(e.target.checked)}
                className="sr-only peer"
              />
              <span
                onClick={() => handleToggleTavily(!tavilyEnabled)}
                className={cn(
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                  tavilyEnabled ? "bg-primary" : "bg-border"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition",
                    tavilyEnabled ? "translate-x-4" : "translate-x-0.5"
                  )}
                />
              </span>
            </label>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            填入 Tavily API key，Agent 就能上网查实时资料、新闻、事实并整理回复。免费额度 1000 次/月，在{" "}
            <a
              href="https://tavily.com"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-primary"
            >
              tavily.com
            </a>{" "}
            注册后生成。关闭开关后 Agent 完全不会调用网页搜索。
          </p>

          <div className="space-y-3 max-w-2xl">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">API Key</label>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={tavilyKey}
                  onChange={(e) => {
                    setTavilyKey(e.target.value);
                    setTavilySaved(false);
                  }}
                  placeholder="tvly-..."
                  className="flex-1 text-sm bg-background border border-border/50 rounded-md px-3 py-2 font-mono text-xs"
                  autoComplete="off"
                />
                <button
                  onClick={handleSaveTavily}
                  disabled={tavilyBusy}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-border/50 hover:bg-foreground/5 disabled:opacity-40"
                >
                  {tavilyBusy ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : tavilySaved ? (
                    <CheckCircle2 size={12} className="text-green-500" />
                  ) : (
                    <Save size={12} />
                  )}
                  {tavilySaved ? "已保存" : "保存"}
                </button>
              </div>
            </div>

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1.5">
                  本月用量上限（次）
                </label>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={tavilyCap}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setTavilyCap(Number.isFinite(n) && n > 0 ? n : 1);
                    setTavilySaved(false);
                  }}
                  className="w-32 text-sm bg-background border border-border/50 rounded-md px-3 py-2 font-mono text-xs"
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <span className="text-xs text-muted-foreground">
                  已用 {tavilyUsage?.count ?? 0} / {tavilyCap}
                  {tavilyUsage?.month ? `（${tavilyUsage.month}）` : ""}
                </span>
                <button
                  onClick={refreshTavilyUsage}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  title="刷新用量"
                >
                  <RefreshCw size={12} />
                </button>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground/80 leading-snug">
              保存后 Agent 下一轮对话就会自动注册 <span className="font-mono">web_search</span> 工具。
              到达上限后会自动禁用，每月 1 号零点（按 UTC 月份）重置。
            </p>
          </div>
        </div>

        {/* Voice wake-word section */}
        <div className="mt-8 pt-6 border-t border-border/20">
          <div className="flex items-center gap-2 mb-3">
            <Mic size={14} className="text-primary" />
            <h3 className="text-sm font-medium flex-1">语音唤醒词</h3>
            <span className="text-xs text-muted-foreground mr-1">
              {wwDownloading
                ? `下载中 ${wwDownloadPct}%`
                : wwEnabled
                  ? wwRunning
                    ? "已启用"
                    : "已启用（未运行）"
                  : "已关闭"}
            </span>
            <button
              type="button"
              disabled={wwDownloading}
              onClick={() => handleToggleWakeWord(!wwEnabled)}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                wwEnabled ? "bg-primary" : "bg-border"
              )}
              aria-pressed={wwEnabled}
              aria-label="wake-word-toggle"
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition",
                  wwEnabled ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </button>
            {(wwEnabled || wwRunning) && (
              <button
                type="button"
                onClick={async () => {
                  await window.electronAPI?.wakeWord?.stop?.();
                  await window.electronAPI?.wakeWord?.saveSettings?.({ enabled: false });
                  setWwEnabled(false);
                  setWwRunning(false);
                  setWwError(null);
                }}
                title="强制关闭并释放麦克风"
                className="ml-1 text-[10px] px-2 py-1 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                强制关闭
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            开启后，后台持续监听麦克风。说出唤醒词（如「小智」）即可像按数字键盘 <span className="font-mono">.</span> 一样
            直接打开 Agent 对话窗口，无需按键。本地 sherpa-onnx 关键词识别，不上传云端；初次开启会下载约 3.3MB 模型。
          </p>

          <div className="space-y-3 max-w-2xl">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">唤醒词</label>
              <select
                value={wwPresetId}
                onChange={(e) => handleChangeWakeWordPreset(e.target.value)}
                disabled={wwDownloading}
                style={{ colorScheme: "dark light" }}
                className="w-full text-sm text-foreground bg-background border border-border/50 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-40"
              >
                {wwPresets.length === 0 ? (
                  <option value="xiaozhi">小智</option>
                ) : (
                  wwPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">
                灵敏度阈值：<span className="font-mono">{wwThreshold.toFixed(1)}</span>
                <span className="text-[10px] opacity-60 ml-2">
                  （低=更敏感但更易误触；高=更严格需清晰发音。推荐 1.5）
                </span>
              </label>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.1}
                value={wwThreshold}
                onChange={(e) =>
                  handleChangeWakeWordThreshold(parseFloat(e.target.value))
                }
                disabled={wwDownloading}
                className="w-full accent-primary disabled:opacity-40"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground/70 font-mono">
                <span>0.5 敏感</span>
                <span>1.5 推荐</span>
                <span>3.0 严格</span>
              </div>
            </div>

            {wwDownloading && (
              <div className="text-xs text-muted-foreground border border-border/40 rounded-md p-2 flex items-center gap-2">
                <Download size={12} className="animate-pulse" />
                <span className="flex-1">
                  正在下载 KWS 模型… {wwDownloadPct > 0 && `${wwDownloadPct}%`}
                </span>
              </div>
            )}

            {!wwDownloading && wwEnabled && wwRunning && (
              <div className="text-xs text-green-700 dark:text-green-400 border border-green-500/30 bg-green-500/5 rounded-md p-2 flex items-start gap-2">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                <span>
                  正在后台监听「
                  {wwPresets.find((p) => p.id === wwPresetId)?.display || wwPresetId}
                  」—— 录音期间自动暂停以避免自触发。
                </span>
              </div>
            )}

            {wwError && (
              <div className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-md p-2 flex items-start gap-2">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{wwError}</span>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground/80 leading-snug">
              触发后的行为和数字键盘 <span className="font-mono">.</span> 一致：直接打开 Agent 录音窗口、
              跳过 AI 推理阶段、走快速路径。模型存放在{" "}
              <span className="font-mono text-[10px]">~/.cache/openwhispr/kws-models/</span>。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
