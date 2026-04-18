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

  // Load saved credentials on mount
  useEffect(() => {
    (async () => {
      const [e, p, c, tk] = await Promise.all([
        window.electronAPI?.getVeSyncEmail?.() ?? "",
        window.electronAPI?.getVeSyncPassword?.() ?? "",
        window.electronAPI?.getVeSyncCountryCode?.() ?? "US",
        window.electronAPI?.getTavilyKey?.() ?? "",
      ]);
      setEmail(e || "");
      setPassword(p || "");
      setCountryCode(c || "US");
      setTavilyKey(tk || "");

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
      await window.electronAPI?.saveTavilyKey?.(tavilyKey.trim());
      setTavilySaved(true);
      setTimeout(() => setTavilySaved(false), 1800);
    } finally {
      setTavilyBusy(false);
    }
  }, [tavilyKey]);

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
            <h3 className="text-sm font-medium">网页搜索（Tavily）</h3>
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
            注册后生成。
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

            <p className="text-[11px] text-muted-foreground/80 leading-snug">
              保存后 Agent 下一轮对话就会自动注册 <span className="font-mono">web_search</span> 工具。
              清空 key 并保存即可禁用。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
