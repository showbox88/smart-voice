import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import ReasoningService, { type AgentStreamChunk } from "../../services/ReasoningService";
import { getSettings } from "../../stores/settingsStore";
import { getAgentSystemPrompt } from "../../config/prompts";
import { createToolRegistry } from "../../services/tools";
import type { ToolRegistry } from "../../services/tools/ToolRegistry";
import { loadAllSkills, type LoadedSkill } from "../../services/skills/skillLoader";
import { SkillResponseMap } from "../../services/skills/skillExecutor";
import {
  isDryRunEnabled as isRouterDryRunEnabled,
  prewarmRouter,
  renderDryRunMessage as renderRouterDryRun,
  runRouterDryRun,
} from "../../services/skills/routerDryRun";
import {
  isDispatchEnabled as isRouterDispatchEnabled,
  classify as classifyWithRouter,
  dispatchAction as dispatchRouterAction,
  renderDispatchMessage as renderRouterDispatch,
  renderUnclearMessage as renderRouterUnclear,
} from "../../services/skills/router";
import type { Message, AgentState, ToolCallInfo } from "./types";

const RAG_NOTE_LIMIT = 5;
const RAG_NOTE_SNIPPET_LENGTH = 500;

const LOCAL_TOOL_MIN_PARAMS_B = 4;

function estimateModelSizeB(modelId: string): number {
  const match = modelId.match(/-([\d.]+)[bB]/);
  return match ? parseFloat(match[1]) : 0;
}

async function buildRAGContext(userText: string): Promise<string> {
  if (!window.electronAPI?.semanticSearchNotes) return "";
  try {
    const results = await window.electronAPI.semanticSearchNotes(userText, RAG_NOTE_LIMIT);
    if (!results || results.length === 0) return "";

    const snippets = await Promise.all(
      results.map(async (r: { id: number; title: string; score?: number }) => {
        const note = await window.electronAPI.getNote(r.id);
        if (!note) return null;
        const content = (note.content || "").slice(0, RAG_NOTE_SNIPPET_LENGTH);
        return `<note id="${note.id}" title="${note.title}">\n${content}\n</note>`;
      })
    );

    return snippets.filter(Boolean).join("\n\n");
  } catch {
    return "";
  }
}

interface UseChatStreamingOptions {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  /** Optional note context to prepend to the system prompt (used by embedded note chat). */
  noteContext?: string;
  onStreamComplete?: (assistantId: string, content: string, toolCalls?: ToolCallInfo[]) => void;
}

export interface ChatStreaming {
  agentState: AgentState;
  toolStatus: string;
  activeToolName: string;
  sendToAI: (userText: string, allMessages: Message[]) => Promise<void>;
  cancelStream: () => void;
}

export function useChatStreaming({
  messages,
  setMessages,
  noteContext: externalNoteContext,
  onStreamComplete,
}: UseChatStreamingOptions): ChatStreaming {
  const { t } = useTranslation();
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [toolStatus, setToolStatus] = useState("");
  const [activeToolName, setActiveToolName] = useState("");
  const mountedRef = useRef(true);
  const messagesRef = useRef<Message[]>([]);
  const noteContextRef = useRef(externalNoteContext);
  noteContextRef.current = externalNoteContext;
  const vesyncAvailableRef = useRef(false);
  const musicAvailableRef = useRef(false);
  const tavilyAvailableRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    (async () => {
      const email = await window.electronAPI?.getVeSyncEmail?.();
      const password = await window.electronAPI?.getVeSyncPassword?.();
      vesyncAvailableRef.current = Boolean(email && password);

      const folder = await window.electronAPI?.getMusicFolder?.();
      const vlc = await window.electronAPI?.musicVlcStatus?.();
      musicAvailableRef.current = Boolean(folder && vlc?.available);

      const tavilyKey = await window.electronAPI?.getTavilyKey?.();
      const tavilyEnabled = await window.electronAPI?.getTavilyEnabled?.();
      const tavilyUsage = await window.electronAPI?.getTavilyUsage?.();
      tavilyAvailableRef.current =
        Boolean(tavilyKey) &&
        tavilyEnabled !== false &&
        (!tavilyUsage || tavilyUsage.count < tavilyUsage.cap);

      // Prewarm the local skill-router so its ~2900-token system prompt is
      // sitting in llama.cpp's KV cache before the user's first utterance.
      // Cold first call is ~14s on Vulkan; with this warm-up the user's
      // real message gets the warm ~1s path. Fire-and-forget — if it fails
      // the real router call just pays the cold cost once. Module-level
      // guard in prewarmRouter() makes this idempotent across remounts.
      if (isRouterDryRunEnabled() || isRouterDispatchEnabled()) {
        try {
          const skills = await loadAllSkills({
            music_folder_configured: Boolean(folder),
            vlc_installed: Boolean(vlc?.available),
            vesync_logged_in: Boolean(email && password),
          });
          void prewarmRouter(skills);
        } catch (err) {
          console.warn("[router-prewarm] skill load failed", err);
        }
      }
    })();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ReasoningService.cancelActiveStream();
    };
  }, []);

  const cancelStream = useCallback(() => {
    ReasoningService.cancelActiveStream();
    setAgentState("idle");
    setToolStatus("");
    setActiveToolName("");
  }, []);

  const sendToAI = useCallback(
    async (userText: string, allMessages: Message[]) => {
      setAgentState("thinking");

      const settings = getSettings();
      const agentMode = settings.agentInferenceMode || "openwhispr";
      const isCloudAgent = agentMode === "openwhispr" && settings.isSignedIn;
      const isLanAgent = agentMode === "self-hosted" && !!settings.remoteAgentUrl;
      const isLocalProvider = !["openai", "groq", "custom", "anthropic", "gemini"].includes(
        settings.agentProvider
      );
      const localModelCanUseTool =
        isLocalProvider && estimateModelSizeB(settings.agentModel) >= LOCAL_TOOL_MIN_PARAMS_B;
      const supportsTools = isCloudAgent || !isLocalProvider || localModelCanUseTool;

      let registry: ToolRegistry | null = null;
      let loadedSkills: LoadedSkill[] = [];
      if (supportsTools) {
        let folder: string | undefined;
        let vlc: { available?: boolean } | undefined;
        let email: string | undefined;
        let password: string | undefined;
        let tavilyKey: string | null | undefined;
        let tavilyEnabled: boolean | undefined;
        let tavilyUsage: { month: string; count: number; cap: number } | undefined;
        try {
          [email, password, folder, vlc, tavilyKey, tavilyEnabled, tavilyUsage] = await Promise.all([
            window.electronAPI?.getVeSyncEmail?.(),
            window.electronAPI?.getVeSyncPassword?.(),
            window.electronAPI?.getMusicFolder?.(),
            window.electronAPI?.musicVlcStatus?.(),
            window.electronAPI?.getTavilyKey?.(),
            window.electronAPI?.getTavilyEnabled?.(),
            window.electronAPI?.getTavilyUsage?.(),
          ]);
          vesyncAvailableRef.current = Boolean(email && password);
          musicAvailableRef.current = Boolean(folder && vlc?.available);
          tavilyAvailableRef.current =
            Boolean(tavilyKey) &&
            tavilyEnabled !== false &&
            (!tavilyUsage || tavilyUsage.count < tavilyUsage.cap);
        } catch {
          // keep last-known values
        }
        const vesyncAvailable = vesyncAvailableRef.current;
        const musicAvailable = musicAvailableRef.current;
        const tavilyAvailable = tavilyAvailableRef.current;
        // Rebuild registry every turn so skill file edits take effect without
        // restarting the app. Base tools (notes/search/clipboard/...) come from
        // createToolRegistry; skill-driven tools (music/vesync) are merged on top.
        registry = createToolRegistry({
          isSignedIn: settings.isSignedIn,
          gcalConnected: settings.gcalConnected,
          cloudBackupEnabled: settings.cloudBackupEnabled,
          vesyncAvailable,
          musicAvailable,
          tavilyAvailable,
        });
        try {
          loadedSkills = await loadAllSkills({
            music_folder_configured: Boolean(folder),
            vlc_installed: Boolean(vlc?.available),
            vesync_logged_in: Boolean(email && password),
          });
          for (const s of loadedSkills) {
            registry.register(s.tool);
          }
        } catch (err) {
          console.warn("[skills] load failed", err);
        }
      }
      const skillResponseMap = new SkillResponseMap(loadedSkills);

      // Phase A: skill-router dry-run. Classifies intent only, no handler
      // dispatch. See docs/skill-router/test-sentences.md.
      if (isRouterDryRunEnabled()) {
        const result = await runRouterDryRun(userText, loadedSkills);
        const content = renderRouterDryRun(result);
        const assistantId = crypto.randomUUID();
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content, isStreaming: false },
        ]);
        onStreamComplete?.(assistantId, content);
        setAgentState("idle");
        setToolStatus("");
        setActiveToolName("");
        return;
      }

      // Phase B half-open dispatch:
      //   action  -> call skill handler directly, render per responseMode
      //   unclear -> render the clarifying question, stop
      //   chat    -> fall through to the normal LLM streaming path below
      // Gated on `localStorage.skillRouterDispatch === "1"` so this path only
      // lights up when the operator opts in. Everything else keeps the legacy
      // tool-calling flow.
      if (isRouterDispatchEnabled() && loadedSkills.length > 0) {
        const decision = await classifyWithRouter(userText, loadedSkills);

        if (decision.intent === "action") {
          const outcome = await dispatchRouterAction(decision, loadedSkills);
          const content = renderRouterDispatch(decision, outcome);
          const assistantId = crypto.randomUUID();
          setMessages((prev) => [
            ...prev,
            { id: assistantId, role: "assistant", content, isStreaming: false },
          ]);
          onStreamComplete?.(assistantId, content);
          setAgentState("idle");
          setToolStatus("");
          setActiveToolName("");
          return;
        }
        if (decision.intent === "unclear") {
          const content = renderRouterUnclear(decision);
          const assistantId = crypto.randomUUID();
          setMessages((prev) => [
            ...prev,
            { id: assistantId, role: "assistant", content, isStreaming: false },
          ]);
          onStreamComplete?.(assistantId, content);
          setAgentState("idle");
          setToolStatus("");
          setActiveToolName("");
          return;
        }
        // intent=chat: fall through to full LLM streaming below
      }

      const ragContext = await buildRAGContext(userText);
      const combinedContext = [noteContextRef.current, ragContext].filter(Boolean).join("\n\n");
      const systemPrompt = getAgentSystemPrompt(
        registry?.getAll().map((t) => t.name),
        combinedContext || undefined
      );

      const llmMessages = [
        { role: "system", content: systemPrompt },
        ...allMessages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
      ];

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);
      setAgentState("streaming");

      try {
        let fullContent = "";
        let stream: AsyncGenerator<AgentStreamChunk>;

        if (isCloudAgent) {
          const executeToolCall = registry
            ? async (name: string, argsJson: string) => {
                const tool = registry.get(name);
                if (!tool)
                  return {
                    data: `Unknown tool: ${name}`,
                    displayText: t("agentMode.tools.unknownTool", { name }),
                  };
                let args: Record<string, unknown>;
                try {
                  args = JSON.parse(argsJson);
                } catch {
                  return {
                    data: `Invalid tool arguments for ${name}`,
                    displayText: t("agentMode.tools.invalidArgs", { name }),
                  };
                }
                const result = await tool.execute(args);
                const data = result.success
                  ? typeof result.data === "string"
                    ? result.data
                    : JSON.stringify(result.data)
                  : result.displayText;
                const metadata =
                  result.success && result.data && typeof result.data === "object"
                    ? (result.data as Record<string, unknown>)
                    : undefined;
                return { data, displayText: result.displayText, metadata };
              }
            : undefined;

          stream = ReasoningService.processTextStreamingCloud(llmMessages, {
            systemPrompt,
            tools: registry?.getAll().map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
            executeToolCall,
          });
        } else {
          const aiTools = registry?.toAISDKFormat();
          stream = ReasoningService.processTextStreamingAI(
            llmMessages,
            settings.agentModel,
            settings.agentProvider,
            { systemPrompt, lanUrl: isLanAgent ? settings.remoteAgentUrl : undefined },
            aiTools
          );
        }

        for await (const chunk of stream) {
          if (!mountedRef.current) {
            ReasoningService.cancelActiveStream();
            break;
          }
          if (chunk.type === "content") {
            fullContent += chunk.text;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: fullContent } : m))
            );
          } else if (chunk.type === "tool_calls") {
            for (const call of chunk.calls) {
              setAgentState("tool-executing");
              setActiveToolName(call.name);
              setToolStatus(
                t(`agentMode.tools.${call.name}Status`, { defaultValue: `Using ${call.name}...` })
              );
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolCalls: [
                          ...(m.toolCalls || []),
                          {
                            id: call.id,
                            name: call.name,
                            arguments: call.arguments,
                            status: "executing" as const,
                          },
                        ],
                      }
                    : m
                )
              );
            }
          } else if (chunk.type === "tool_result") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId && m.toolCalls
                  ? {
                      ...m,
                      toolCalls: m.toolCalls.map((tc) =>
                        tc.id === chunk.callId
                          ? {
                              ...tc,
                              status: "completed" as const,
                              result: chunk.displayText,
                              ...(chunk.metadata ? { metadata: chunk.metadata } : {}),
                            }
                          : tc
                      ),
                    }
                  : m
              )
            );
            setAgentState("streaming");
            setToolStatus("");
            setActiveToolName("");

            // Skill-driven short-circuit: if response_mode is passthrough or
            // template, use the tool's displayText (or rendered template) as
            // the final assistant message and abort the LLM before it can
            // append commentary.
            const decision = skillResponseMap.decide(
              chunk.toolName,
              chunk.displayText,
              chunk.metadata
            );
            if (decision.kind === "final") {
              fullContent = decision.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: decision.text, isStreaming: false }
                    : m
                )
              );
              ReasoningService.cancelActiveStream();
              break;
            }
          }
        }

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
        );

        const finalMsg = messagesRef.current.find((m) => m.id === assistantId);
        onStreamComplete?.(assistantId, fullContent, finalMsg?.toolCalls);
      } catch (error) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `${t("agentMode.chat.errorPrefix")}: ${(error as Error).message}`,
                  isStreaming: false,
                }
              : m
          )
        );
      }

      setAgentState("idle");
      setToolStatus("");
      setActiveToolName("");
    },
    [t, setMessages, onStreamComplete]
  );

  return {
    agentState,
    toolStatus,
    activeToolName,
    sendToAI,
    cancelStream,
  };
}
