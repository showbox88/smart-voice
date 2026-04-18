import { useCallback, useEffect, useState } from "react";
import {
  Plug,
  Power,
  RefreshCw,
  LogIn,
  LogOut,
  Loader2,
  AlertCircle,
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

  // Load saved credentials on mount
  useEffect(() => {
    (async () => {
      const [e, p, c] = await Promise.all([
        window.electronAPI?.getVeSyncEmail?.() ?? "",
        window.electronAPI?.getVeSyncPassword?.() ?? "",
        window.electronAPI?.getVeSyncCountryCode?.() ?? "US",
      ]);
      setEmail(e || "");
      setPassword(p || "");
      setCountryCode(c || "US");

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
      </div>
    </div>
  );
}
