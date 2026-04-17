import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, Key, Cpu, Network, Volume2, Play } from "lucide-react";
import { cn } from "../lib/utils";
import { useSettingsStore } from "../../stores/settingsStore";
import { HotkeyInput } from "../ui/HotkeyInput";
import { Toggle } from "../ui/toggle";
import {
  SettingsRow,
  SettingsPanel,
  SettingsPanelRow,
  SectionHeader,
  InferenceModeSelector,
} from "../ui/SettingsSection";
import type { InferenceModeOption } from "../ui/SettingsSection";
import ReasoningModelSelector from "../ReasoningModelSelector";
import SelfHostedPanel from "../SelfHostedPanel";
import { validateHotkeyForSlot } from "../../utils/hotkeyValidation";
import type { InferenceMode } from "../../types/electron";

export default function AgentModeSettings() {
  const { t } = useTranslation();
  const {
    agentEnabled,
    setAgentEnabled,
    agentKey,
    setAgentKey,
    dictationKey,
    meetingKey,
    agentModel,
    setAgentModel,
    agentProvider,
    setAgentProvider,
    agentSystemPrompt,
    setAgentSystemPrompt,
    cloudAgentMode,
    setCloudAgentMode,
    agentInferenceMode,
    setAgentInferenceMode,
    remoteAgentUrl,
    setRemoteAgentUrl,
    isSignedIn,
    openaiApiKey,
    setOpenaiApiKey,
    anthropicApiKey,
    setAnthropicApiKey,
    geminiApiKey,
    setGeminiApiKey,
    groqApiKey,
    setGroqApiKey,
    customReasoningApiKey,
    setCustomReasoningApiKey,
    cloudReasoningBaseUrl,
    setCloudReasoningBaseUrl,
  } = useSettingsStore();

  const validateAgentHotkey = useCallback(
    (hotkey: string) =>
      validateHotkeyForSlot(
        hotkey,
        {
          "settingsPage.general.hotkey.title": dictationKey,
          "settingsPage.general.meetingHotkey.title": meetingKey,
        },
        t
      ),
    [dictationKey, meetingKey, t]
  );

  const agentModes: InferenceModeOption[] = [
    {
      id: "openwhispr",
      label: t("agentMode.settings.modes.openwhispr"),
      description: t("agentMode.settings.modes.openwhisprDesc"),
      icon: <Cloud className="w-4 h-4" />,
    },
    {
      id: "providers",
      label: t("agentMode.settings.modes.providers"),
      description: t("agentMode.settings.modes.providersDesc"),
      icon: <Key className="w-4 h-4" />,
    },
    {
      id: "local",
      label: t("agentMode.settings.modes.local"),
      description: t("agentMode.settings.modes.localDesc"),
      icon: <Cpu className="w-4 h-4" />,
    },
    {
      id: "self-hosted",
      label: t("agentMode.settings.modes.selfHosted"),
      description: t("agentMode.settings.modes.selfHostedDesc"),
      icon: <Network className="w-4 h-4" />,
    },
  ];

  const handleAgentModeSelect = (mode: InferenceMode) => {
    if (mode === agentInferenceMode) return;
    setAgentInferenceMode(mode);
    setCloudAgentMode(mode === "openwhispr" ? "openwhispr" : "byok");
    if (mode === "openwhispr" || mode === "self-hosted") {
      window.electronAPI?.llamaServerStop?.();
    }
  };

  const renderModelSelector = (mode?: "cloud" | "local") => (
    <ReasoningModelSelector
      reasoningModel={agentModel}
      setReasoningModel={setAgentModel}
      localReasoningProvider={agentProvider}
      setLocalReasoningProvider={setAgentProvider}
      cloudReasoningBaseUrl={cloudReasoningBaseUrl}
      setCloudReasoningBaseUrl={setCloudReasoningBaseUrl}
      openaiApiKey={openaiApiKey}
      setOpenaiApiKey={setOpenaiApiKey}
      anthropicApiKey={anthropicApiKey}
      setAnthropicApiKey={setAnthropicApiKey}
      geminiApiKey={geminiApiKey}
      setGeminiApiKey={setGeminiApiKey}
      groqApiKey={groqApiKey}
      setGroqApiKey={setGroqApiKey}
      customReasoningApiKey={customReasoningApiKey}
      setCustomReasoningApiKey={setCustomReasoningApiKey}
      mode={mode}
    />
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("agentMode.settings.title")}
        description={t("agentMode.settings.description")}
      />

      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("agentMode.settings.enabled")}
            description={t("agentMode.settings.enabledDescription")}
          >
            <Toggle checked={agentEnabled} onChange={setAgentEnabled} />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>

      {agentEnabled && (
        <>
          <div>
            <SectionHeader
              title={t("agentMode.settings.hotkey")}
              description={t("agentMode.settings.hotkeyDescription")}
            />
            <HotkeyInput value={agentKey} onChange={setAgentKey} validate={validateAgentHotkey} />
          </div>

          {isSignedIn ? (
            <>
              <InferenceModeSelector
                modes={agentModes}
                activeMode={agentInferenceMode}
                onSelect={handleAgentModeSelect}
              />

              {agentInferenceMode === "providers" && renderModelSelector("cloud")}
              {agentInferenceMode === "local" && renderModelSelector("local")}

              {agentInferenceMode === "self-hosted" && (
                <SelfHostedPanel
                  service="reasoning"
                  url={remoteAgentUrl}
                  onUrlChange={setRemoteAgentUrl}
                />
              )}
            </>
          ) : (
            renderModelSelector()
          )}

          <div>
            <SectionHeader
              title={t("agentMode.settings.systemPrompt")}
              description={t("agentMode.settings.systemPromptDescription")}
            />
            <SettingsPanel>
              <SettingsPanelRow>
                <textarea
                  value={agentSystemPrompt}
                  onChange={(e) => setAgentSystemPrompt(e.target.value)}
                  placeholder={t("agentMode.settings.systemPromptPlaceholder")}
                  rows={4}
                  className="w-full text-xs bg-transparent border border-border/50 rounded-md px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary/30 placeholder:text-muted-foreground/50"
                />
              </SettingsPanelRow>
            </SettingsPanel>
          </div>

          <TtsVoiceSettings />
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// TTS voice output settings (Edge Read Aloud + ElevenLabs)
// Stores preferences in localStorage — read by AgentOverlay at speak-time.
// ──────────────────────────────────────────────────────────────────────
const TTS_ENABLED_KEY = "xiaozhi.tts.enabled";
const TTS_PROVIDER_KEY = "xiaozhi.tts.provider"; // "edge" | "elevenlabs"
const TTS_VOICE_KEY = "xiaozhi.tts.voice"; // Edge voice ShortName
const TTS_ELEVEN_VOICE_KEY = "xiaozhi.tts.elevenlabs.voiceId";
const TTS_ELEVEN_KEY_KEY = "xiaozhi.tts.elevenlabs.apiKey";
const DEFAULT_TTS_VOICE = "zh-CN-XiaoxiaoNeural";
const SAMPLE_PREVIEW_TEXT = "你好，我是小智，很高兴为你服务。";

type TtsProvider = "edge" | "elevenlabs";

function TtsVoiceSettings() {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [provider, setProvider] = useState<TtsProvider>("edge");
  const [edgeVoice, setEdgeVoice] = useState<string>(DEFAULT_TTS_VOICE);
  const [edgeVoices, setEdgeVoices] = useState<Array<{ id: string; label: string }>>([]);
  const [elevenVoiceId, setElevenVoiceId] = useState<string>("");
  const [elevenApiKey, setElevenApiKey] = useState<string>("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string>("");
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const testUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const storedEnabled = localStorage.getItem(TTS_ENABLED_KEY);
    if (storedEnabled !== null) setEnabled(storedEnabled !== "false");

    const storedProvider = localStorage.getItem(TTS_PROVIDER_KEY);
    if (storedProvider === "elevenlabs" || storedProvider === "edge") setProvider(storedProvider);

    const storedVoice = localStorage.getItem(TTS_VOICE_KEY);
    if (storedVoice) setEdgeVoice(storedVoice);

    const storedElevenVoice = localStorage.getItem(TTS_ELEVEN_VOICE_KEY);
    if (storedElevenVoice) setElevenVoiceId(storedElevenVoice);

    const storedElevenKey = localStorage.getItem(TTS_ELEVEN_KEY_KEY);
    if (storedElevenKey) setElevenApiKey(storedElevenKey);

    window.electronAPI
      ?.ttsListVoices?.()
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) setEdgeVoices(list);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  const displayEdgeVoices =
    edgeVoices.length > 0 ? edgeVoices : [{ id: DEFAULT_TTS_VOICE, label: "晓晓 (女, 自然)" }];

  const handleToggle = (next: boolean) => {
    setEnabled(next);
    localStorage.setItem(TTS_ENABLED_KEY, next ? "true" : "false");
  };

  const handleProviderChange = (next: TtsProvider) => {
    setProvider(next);
    localStorage.setItem(TTS_PROVIDER_KEY, next);
  };

  const handleEdgeVoice = (id: string) => {
    setEdgeVoice(id);
    localStorage.setItem(TTS_VOICE_KEY, id);
  };

  const handleElevenVoice = (id: string) => {
    setElevenVoiceId(id);
    localStorage.setItem(TTS_ELEVEN_VOICE_KEY, id);
  };

  const handleElevenKey = (k: string) => {
    setElevenApiKey(k);
    localStorage.setItem(TTS_ELEVEN_KEY_KEY, k);
  };

  const stopTest = () => {
    if (testAudioRef.current) {
      testAudioRef.current.pause();
      testAudioRef.current.src = "";
      testAudioRef.current = null;
    }
    if (testUrlRef.current) {
      URL.revokeObjectURL(testUrlRef.current);
      testUrlRef.current = null;
    }
  };

  useEffect(() => stopTest, []);

  const handleTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestError("");
    try {
      if (!window.electronAPI?.ttsSynthesize) {
        setTestError("TTS 接口未挂载");
        return;
      }
      const synthOpts: Record<string, unknown> = { provider };
      if (provider === "elevenlabs") {
        if (!elevenApiKey || !elevenVoiceId) {
          setTestError("需要先填 API Key 和 Voice ID");
          return;
        }
        synthOpts.voice = elevenVoiceId;
        synthOpts.elevenLabsApiKey = elevenApiKey;
      } else {
        synthOpts.voice = edgeVoice;
      }
      const res = await window.electronAPI.ttsSynthesize(SAMPLE_PREVIEW_TEXT, synthOpts);
      if (!res || !res.success) {
        const msg = (res as { error?: string })?.error || "unknown_error";
        console.warn("[xiaozhi-tts-settings] preview failed:", msg);
        setTestError(msg);
        return;
      }
      stopTest();
      const bytes =
        res.audio instanceof Uint8Array ? res.audio : new Uint8Array(res.audio as ArrayBuffer);
      const blob = new Blob([bytes], { type: res.mime || "audio/mp3" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      testAudioRef.current = audio;
      testUrlRef.current = url;
      audio.addEventListener("ended", stopTest);
      audio.addEventListener("error", stopTest);
      await audio.play();
    } catch (err) {
      console.warn("[xiaozhi-tts-settings] preview error", err);
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <SectionHeader
        title="语音输出 (Voice Output)"
        description="让小智把回复用语音读出来 · 免费用 Edge Read Aloud，想要克隆音色切到 ElevenLabs"
      />
      <SettingsPanel>
        <SettingsRow
          icon={Volume2}
          title="启用语音输出"
          description="开启后，小智每次回复都会朗读"
        >
          <Toggle checked={enabled} onCheckedChange={handleToggle} />
        </SettingsRow>

        {/* Provider tabs */}
        <SettingsPanelRow>
          <div className="flex gap-2 w-full">
            <button
              type="button"
              onClick={() => handleProviderChange("edge")}
              disabled={!enabled}
              className={cn(
                "flex-1 text-xs px-3 py-2 rounded-md border transition-colors disabled:opacity-50",
                provider === "edge"
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/50 hover:bg-foreground/5 text-muted-foreground"
              )}
            >
              Edge Read Aloud (免费)
            </button>
            <button
              type="button"
              onClick={() => handleProviderChange("elevenlabs")}
              disabled={!enabled}
              className={cn(
                "flex-1 text-xs px-3 py-2 rounded-md border transition-colors disabled:opacity-50",
                provider === "elevenlabs"
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/50 hover:bg-foreground/5 text-muted-foreground"
              )}
            >
              ElevenLabs (克隆)
            </button>
          </div>
        </SettingsPanelRow>

        {/* Provider-specific settings */}
        {provider === "edge" ? (
          <SettingsPanelRow>
            <select
              value={edgeVoice}
              onChange={(e) => handleEdgeVoice(e.target.value)}
              disabled={!enabled}
              className="w-full text-xs bg-transparent border border-border/50 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary/30 disabled:opacity-50"
            >
              {displayEdgeVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </SettingsPanelRow>
        ) : (
          <>
            <SettingsPanelRow>
              <div className="flex flex-col gap-1 w-full">
                <label className="text-[11px] text-muted-foreground">API Key (xi-api-key)</label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? "text" : "password"}
                    value={elevenApiKey}
                    onChange={(e) => handleElevenKey(e.target.value)}
                    placeholder="sk_..."
                    disabled={!enabled}
                    className="flex-1 text-xs font-mono bg-transparent border border-border/50 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary/30 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="text-[11px] px-2 rounded-md border border-border/50 hover:bg-foreground/5"
                  >
                    {showKey ? "隐藏" : "显示"}
                  </button>
                </div>
              </div>
            </SettingsPanelRow>
            <SettingsPanelRow>
              <div className="flex flex-col gap-1 w-full">
                <label className="text-[11px] text-muted-foreground">
                  Voice ID（在 ElevenLabs → Voices → 点你的声音 → 复制 ID）
                </label>
                <input
                  type="text"
                  value={elevenVoiceId}
                  onChange={(e) => handleElevenVoice(e.target.value)}
                  placeholder="21m00Tcm4TlvDq8ikWAM"
                  disabled={!enabled}
                  className="w-full text-xs font-mono bg-transparent border border-border/50 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary/30 disabled:opacity-50"
                />
              </div>
            </SettingsPanelRow>
          </>
        )}

        <SettingsPanelRow>
          <div className="flex items-center gap-2 w-full">
            <button
              type="button"
              onClick={handleTest}
              disabled={!enabled || testing}
              className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-md border border-border/50 hover:bg-foreground/5 disabled:opacity-50"
            >
              <Play size={12} />
              {testing ? "合成中..." : "试听"}
            </button>
            {testError && (
              <span className="text-[11px] text-destructive font-mono truncate">{testError}</span>
            )}
          </div>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}
