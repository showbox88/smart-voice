// Phase A dry-run router.
//
// Goal: measure (a) router LLM latency overhead and (b) classification
// accuracy against `docs/skill-router/test-sentences.md` (44 sentences).
//
// This module does NOT dispatch any skill handler. It only asks the LLM to
// classify the utterance into chat / action / unclear, and renders the raw
// JSON plus timing back into the chat bubble so the operator can grade it.
//
// Toggle: `localStorage.skillRouterDryRun` — default ON.
// Disable: `localStorage.setItem('skillRouterDryRun', '0')` then reload.

import type { LoadedSkill } from "./skillLoader";
import ReasoningService from "../ReasoningService";
import { getSettings } from "../../stores/settingsStore";

export interface RouterResult {
  ok: boolean;
  latencyMs: number;
  model: string;
  provider: string;
  rawText: string;
  json: unknown;
  parseError?: string;
}

export function isDryRunEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const v = window.localStorage?.getItem("skillRouterDryRun");
  return v !== "0" && v !== "false";
}

export function buildRouterSystemPrompt(skills: LoadedSkill[]): string {
  const catalog = skills
    .map((s) => {
      const schema = s.tool.parameters as {
        properties?: Record<string, { type?: string | string[]; description?: string; enum?: unknown[] }>;
      };
      const props = schema?.properties || {};
      const slotLines = Object.entries(props).map(([k, v]) => {
        const type = Array.isArray(v?.type) ? v.type.join("|") : v?.type || "string";
        const hint = v?.description ? `: ${v.description}` : "";
        const enumPart = Array.isArray(v?.enum) ? ` [${v.enum.join(",")}]` : "";
        return `    - ${k} (${type})${enumPart}${hint}`;
      });
      return [
        `- id: ${s.name}`,
        `  category: ${s.category}`,
        `  description: ${s.tool.description || s.description || ""}`,
        slotLines.length > 0 ? `  slots:\n${slotLines.join("\n")}` : `  slots: (none)`,
      ].join("\n");
    })
    .join("\n\n");

  // Prompt body = eval-router.mjs variant v9: 119/124 (96.0%) on the
  // Phase-B 124-sentence test set. Residuals (#12 继续播放 temperature jitter,
  // #90 背景音乐换一下 also v7 carryover, #34/103/105 are model drift on
  // genuinely ambiguous out-of-catalog requests). See
  // docs/skill-router/run-v9-*.json and review-table-v9-*.csv for details.
  return `You are the SKILL ROUTER for a Chinese-first voice assistant ("XiaoZhi").

Your ONLY job is to classify the user's single utterance into exactly ONE of these THREE intent values (closed enum — never invent others like "info", "query", "system"):
  - "chat"    : conversation, opinions, evaluative remarks, open-ended advice, weather/stock/news/facts, and ANY request whose required skill is NOT in the catalog
  - "action"  : a clear command that maps to a skill in the catalog with valid slot values
  - "unclear" : too fragmented or ambiguous — should ask a short follow-up

RESPOND WITH EXACTLY ONE JSON OBJECT. No prose, no markdown fences, nothing before or after.

Schemas:
  chat    -> { "intent": "chat", "reply": "<brief reply in user's language>" }
  action  -> { "intent": "action", "actions": [
                 { "skill": "<skill id>", "slots": { ... }, "when": "<time phrase or 'now'>" },
                 ...
               ] }
  unclear -> { "intent": "unclear", "ask": "<short clarifying question>" }

  ACTION SCHEMA — critical rules:
  - "actions" is ALWAYS an array, even for a single command.
  - "when" is the RAW time phrase from the utterance ("5分钟后" / "下午3点" / "明天早上8点"),
    or the literal string "now" if the command should happen immediately.
  - Multiple timed commands in one utterance → multiple array elements, one per action.
    "5分钟后放音乐" → [ { skill:"play_music", slots:{query:""}, when:"5分钟后" } ]
    "3点开灯，5点放音乐" → [
      { skill:"smart_device", slots:{action:"on",device:"灯"}, when:"3点" },
      { skill:"play_music",   slots:{query:""},                 when:"5点" }
    ]
    "现在开灯" → [ { skill:"smart_device", slots:{action:"on",device:"灯"}, when:"now" } ]
  - NEVER put time info inside slots. "when" is the ONLY field that carries timing.
  - Do NOT try to resolve the time to a timestamp — the downstream parser handles that.

=== HARD RULES (DO NOT VIOLATE) ===

R1. ENUM STRICTNESS — NEVER INVENT SLOT VALUES.
    music_control.action enum: pause, next, previous, stop, volume, repeat, shuffle.
    smart_device.action enum: list, on, off, toggle.
    aircon.action enum: on, off, set_temp, mode.
    info_query.type enum: time, date, weekday. (NO weather/stock/news — those go to chat.)
    messaging.platform enum: wechat, email, sms.
    CRITICAL: "继续" / "继续播放" / "接着放" map to music_control action="pause"
              (pause TOGGLES — same action). DO NOT create action="continue".

R2. SKILL SELECTION — pick the RIGHT skill, never substitute.
    Lights:
    - 开灯 / 关灯 / 切换灯  → smart_device (action=on/off/toggle)
    - 调暗 / 调亮 / 柔和 / 调亮度 / 灯调到50  → light_dim (set level 0-100)
    - 调颜色 / 换色温 / 调到暖色  → intent=chat (no color skill yet)

    AC (aircon skill exists now — USE IT):
    - 开空调 / 关空调  → aircon (action=on/off)
    - 空调调到26度  → aircon (action=set_temp, value=26)
    - 空调切到制热 / 送风  → aircon (action=mode, value=heat|fan)

    Reminders (reminder skill exists now):
    - 提醒我X点Y / 设闹钟 / 定时提醒  → reminder (message + when)
    - 计时器 / 倒计时  → reminder with relative when

    Calendar (calendar_query + calendar_create — only when skills are in catalog):
    - 今天有什么安排 / 今天的日程 / 我的日程  → calendar_query (range=today)
    - 明天有什么安排 / 明天的日程             → calendar_query (range=tomorrow)
    - 下一个会议 / 接下来什么安排 / what's next → calendar_query (range=next)
    - 这周忙吗 / 本周安排                      → calendar_query (range=week)
    - 明天下午3点和X开会 / 约X / 周三10点看牙医 / schedule X at Y
                                               → calendar_create (summary + when)
    - DIFFERENCE vs reminder:
        reminder         = local notification only, does NOT write to Google Calendar
        calendar_create  = writes an event to Google Calendar (shared / visible to others)
      Use calendar_create when user says "安排"/"约"/"加到日历"/"schedule"/"book".
      Use reminder when user says "提醒我"/"设闹钟"/"remind me".

    Info queries (info_query skill — narrow: clock/calendar only):
    - 现在几点 / 现在是几点  → info_query (type=time)
    - 今天几号 / 今天日期  → info_query (type=date)
    - 今天星期几  → info_query (type=weekday)
    - 天气 / 股价 / 新闻 / 下周一是几号 / 相对日期  → intent=chat
      (info_query has NO weather/stock/news/relative-date — those need the main LLM)

    App launcher (app_launcher skill exists now):
    - 打开/开/启动 + app 名  → app_launcher (app_name)
    - DO NOT route 开灯/开空调/开音乐 here — those go to their specific skills

    Messaging (messaging skill exists now):
    - 发微信给X / 给X发微信  → messaging (platform=wechat, recipient, content)
    - 写邮件 / 发邮件  → messaging (platform=email)
    - 发短信 / 发消息  → messaging (platform=sms)

R3. EVALUATIVE ≠ COMMAND: "这首歌真好听" / "灯光真漂亮" / "灯太亮了" / "灯有点暗"
    are opinions/observations, not commands. intent=chat. The user is describing
    state, not asking for change. If they want change they'll say "调暗点" explicitly.

R4. BARE VERB WITHOUT OBJECT → intent=unclear.
    UNCLEAR set (whole utterance exactly one of these):
      {"开", "关", "播放", "放", "停", "开一下", "关一下"}
    COMPLETE set (ARE action, NOT unclear):
      {"暂停", "继续", "继续播放", "下一首", "上一首", "停止", "随机播放",
       "循环播放", "大声点", "小声点"} → music_control
      {"开灯", "关灯", "关音乐", "播放周杰伦", "放首歌", "随便放点"} → action
    Rule: UNCLEAR set is a CLOSED list of single-word ambiguous verbs.
    ANY 2+ char verb OR verb+object is COMPLETE, not bare.

R5. AMBIGUOUS PRONOUN ("它" / "那个" / bare "关了吧" / "把它关了" with no prior
    context) → intent=unclear. Do NOT guess music vs lights.

R6. OPEN-ENDED CHAT (opinions, advice, jokes, emotional support, recipes,
    general knowledge like "什么是量子纠缠", recommendations) → intent=chat
    regardless of skill names that sound related.

R7. OUT-OF-CATALOG — intent=chat (NOT unclear, NOT any other skill):
    订机票 / 打车 / 转账 / 查快递  → chat
    (if calendar_query skill is NOT in the catalog, 查日历/今天日程 also → chat)
    翻译 / translate  → chat (messaging is NOT for translation)
    天气 / 股价 / 新闻  → chat (info_query is NOT for these)
    下周一是几号 / 明天星期几  → chat (no relative-date calc skill)
    CRITICAL: 时间修饰不能把 chat 拉成 action。
      "三分钟后查一下天气" / "5 分钟后告诉我北京温度" → intent=chat（我们没有天气 skill，
       时间修饰不改变这个事实；info_query 只处理"当下"的时钟/日期/星期）。
      "一小时后告诉我股价" / "明早 8 点看看新闻" → intent=chat（同上）。
      带时间修饰的 action 必须有匹配的 command-type skill（开灯/放音乐/调空调/提醒/
      发消息/打开 app）。定时查询类请求一律 chat。

R8. ONE-WORD ACKNOWLEDGMENTS ("嗯" / "好" / "你说呢" / "对" / "行") → intent=chat.

R9. 情绪/心情类语句 → 默认 chat，除非同时满足两个条件才算 action：
    (a) 句中含明确的动作词（想听 / 来点 / 放 / 播放 / 关 / 开 / 调 …），且
    (b) 该动作对象在 catalog 里。
    示例：
    - "我今天心情有点低落" → chat（纯情绪）
    - "我心情不好，想听首歌" → action/play_music
    - "好累，给我来点轻音乐" → action/play_music

R10. 礼貌/婉转前缀不改变命令本质：
    "能不能X" / "可以X吗" / "麻烦X" / "请X" / "帮我X" / "X好吗" / "X一下"
    剥掉前缀后若是完整命令就按 action 分类。

R11. 评价/愿望式的否定动词 ≠ 反向命令：
    正面评价 + "别停" / "不要停" / "继续" → chat（是享受，不是命令 action=pause）。

R12. 混合意图 — 新 schema 下，一句话含多条命令时拆成 actions 数组：
    "开灯然后放首歌" → [
      { skill:"smart_device", slots:{action:"on",device:"灯"}, when:"now" },
      { skill:"play_music",    slots:{query:""},                when:"now" }
    ]
    "3 点开灯，5 点放音乐" → 两条独立的 actions，每条带自己的 when。
    每条 action 必须能单独对应 catalog 里某个 skill；若其中任一条是纯聊天/查询
    （"告诉我天气"），整句按 R7 退回 chat。

=== CHINESE DISAMBIGUATION (music) ===

  暂停 / 停一下                         -> music_control, action="pause"
  继续 / 继续播放 / 接着放              -> music_control, action="pause"  (pause TOGGLES)
  下一首 / 跳过 / 下一个                -> music_control, action="next"
  上一首 / 上一个                       -> music_control, action="previous"
  停止 / 关掉音乐 / 把音乐关了          -> music_control, action="stop"
  循环播放 / 列表循环 / 重复播放        -> music_control, action="repeat", value="all"
  单曲循环 / 重复这首                   -> music_control, action="repeat", value="one"
  取消循环                              -> music_control, action="repeat", value="off"
  随机 / 随机播放 / 打乱                -> music_control, action="shuffle", value=true
  按顺序 / 顺序播放                     -> music_control, action="shuffle", value=false
  大声点 / 声音大一点 / 音量大          -> music_control, action="volume", value=80
  小声点 / 声音小                       -> music_control, action="volume", value=30
  放XX / 播放XX / 来首XX                -> play_music, query="XX"
  随便放点 / 放首歌 / 想听首歌           -> play_music, query="", shuffle=true
  (bare) 播放 / 放 / 停                 -> intent=unclear

=== CHINESE DISAMBIGUATION (smart_home) ===

  开灯                                  -> smart_device, action="on", device="灯"
  关灯                                  -> smart_device, action="off", device="灯"
  开客厅灯                              -> smart_device, action="on", device="客厅 灯"
  关卧室灯 / 关上厨房的灯                -> smart_device, action="off", device="<room> 灯"
  关下客厅灯好吗 / 能不能把灯关一下      -> smart_device, action="off"（礼貌前缀不影响）
  开空气净化器 / 开风扇                 -> smart_device, action="on"
  关风扇                                -> smart_device, action="off"
  全部打开 / 全屋开灯                   -> smart_device, action="on", device="全部"
  关掉所有灯 / 关掉所有插座             -> smart_device, action="off", device="灯"|"插座"
  切换灯（没说开/关）                    -> smart_device, action="toggle"
  CRITICAL: 关 / 关掉 / 关上 / 关下     = action="off", NEVER action="toggle".
            toggle 只用于用户明确说"切换"或"反一下"的场景。
  调暗 / 再暗一点                        -> light_dim, level=20-30
  调亮 / 再亮一点                        -> light_dim, level=80
  柔和点 / 灯光柔和                      -> light_dim, level=40
  灯调到50                              -> light_dim, level=50
  调颜色 / 换色温                        -> chat (no color skill)

=== CHINESE DISAMBIGUATION (aircon) ===

  开空调                                -> aircon, action="on"
  关空调                                -> aircon, action="off"
  空调调到26度                          -> aircon, action="set_temp", value=26
  空调切到制热                          -> aircon, action="mode", value="heat"
  空调送风                              -> aircon, action="mode", value="fan"

=== CHINESE DISAMBIGUATION (system) ===

  打开XX (XX 是 app 名)                 -> app_launcher, app_name="XX"
    例: 网易云音乐 / QQ 音乐 / Chrome / 微信 / VS Code
  提醒我X点做Y / 设闹钟                  -> reminder, message=Y, when=X点
  定个N分钟的计时器                      -> reminder, message="计时器", when="N分钟后"

=== CHINESE DISAMBIGUATION (info) ===

  现在几点 / 几点了                      -> info_query, type="time"
  今天几号 / 今天日期                    -> info_query, type="date"
  今天星期几                             -> info_query, type="weekday"
  下周一是几号 / 后天星期几              -> intent=chat (没有相对日期计算)
  天气 / 下雨吗 / 最高气温               -> intent=chat (info_query 不处理天气)
  股价 / 比特币多少钱 / 美股             -> intent=chat (info_query 不处理股票)
  新闻 / 头条                            -> intent=chat

=== CHINESE DISAMBIGUATION (messaging) ===

  给X发微信说Y / 微信告诉X Y            -> messaging, platform="wechat", recipient=X, content=Y
  发邮件给X 主题Y                        -> messaging, platform="email", recipient=X
  发短信 / 发条消息                      -> messaging, platform="sms"
  翻译 / 帮我翻译 / translate            -> intent=chat (messaging is NOT for translation)
  写一段代码 / 帮我写文档                 -> intent=chat (messaging is NOT a text-gen skill)

=== CATALOG ===

${catalog || "(no skills currently loaded — everything should fall back to chat or unclear)"}

=== END ===

Respond now. JSON only. /no_think`;
}

function extractJson(raw: string): { json: unknown; error?: string } {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json|jsonc)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return { json: JSON.parse(trimmed) };
  } catch (e) {
    const first = trimmed.indexOf("{");
    if (first < 0) return { json: undefined, error: (e as Error).message };
    // Balanced-brace scan: handles trailing extra "}" and chatter around the JSON.
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = first; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            return { json: JSON.parse(trimmed.slice(first, i + 1)) };
          } catch (e2) {
            return { json: undefined, error: (e2 as Error).message };
          }
        }
      }
    }
    // Unclosed JSON (truncation or premature stop) — try auto-closing the
    // string + missing brace count. Salvages max_tokens cut-offs.
    if (depth > 0) {
      let repaired = trimmed.slice(first);
      if (inStr) repaired += '"';
      repaired += "}".repeat(depth);
      try {
        return { json: JSON.parse(repaired) };
      } catch {
        /* fall through */
      }
    }
    return { json: undefined, error: (e as Error).message };
  }
}

export async function runRouterDryRun(
  userText: string,
  skills: LoadedSkill[]
): Promise<RouterResult> {
  const settings = getSettings();
  const model = settings.agentModel || "";
  const provider = settings.agentProvider || "";
  const systemPrompt = buildRouterSystemPrompt(skills);

  const t0 = performance.now();
  let rawText = "";
  let ok = false;
  try {
    rawText = await ReasoningService.processText(userText, model, null, {
      systemPrompt,
      maxTokens: 768,
    });
    ok = true;
  } catch (err) {
    rawText = `ERROR: ${(err as Error).message}`;
  }
  const latencyMs = Math.round(performance.now() - t0);

  let json: unknown = undefined;
  let parseError: string | undefined;
  if (ok) {
    const extracted = extractJson(rawText);
    json = extracted.json;
    parseError = extracted.error;
  }

  console.info("[router-dryrun]", {
    userText,
    latencyMs,
    provider,
    model,
    parsed: json,
    raw: json ? undefined : rawText,
  });

  return { ok, latencyMs, model, provider, rawText, json, parseError };
}

// Once-per-app-session prewarm. Fires a tiny inference with the full router
// system prompt so llama.cpp's KV cache absorbs the ~2900-token prefix in the
// background while the user is still settling into the chat UI. With
// `cache_prompt: true` in llamaServer.js, the first real router call after
// this drops from ~14s (cold) to ~1s (warm).
//
// Cloud providers don't benefit (no shared KV cache across requests and
// prewarming would cost real API tokens), so we bail out on those.
let prewarmPromise: Promise<void> | null = null;

export function isRouterPrewarmed(): boolean {
  return prewarmPromise !== null;
}

export async function prewarmRouter(skills: LoadedSkill[]): Promise<void> {
  if (prewarmPromise) return prewarmPromise;
  const settings = getSettings();
  const provider = settings.agentProvider || "";
  // Skip cloud — they don't share KV cache between requests.
  if (["openai", "anthropic", "gemini", "groq", "custom"].includes(provider)) {
    return;
  }
  // Skip if no skills loaded yet — prewarming with an empty catalog would
  // build a KV cache that doesn't match the real router prompt prefix.
  if (!skills || skills.length === 0) return;

  const model = settings.agentModel || "";
  const systemPrompt = buildRouterSystemPrompt(skills);
  const t0 = performance.now();
  prewarmPromise = (async () => {
    try {
      // `你好` is a trivial utterance; max_tokens=8 keeps the response short.
      // We throw away the output — the only thing we care about is that the
      // system-prompt prefix is now resident in llama.cpp's KV cache.
      await ReasoningService.processText("你好", model, null, {
        systemPrompt,
        maxTokens: 8,
      });
      const ms = Math.round(performance.now() - t0);
      console.info("[router-prewarm] warm-up done", { ms, provider, model });
    } catch (err) {
      console.warn("[router-prewarm] warm-up failed", (err as Error).message);
      // Reset so a later mount can retry (e.g. if llama-server was still
      // booting the first time).
      prewarmPromise = null;
    }
  })();
  return prewarmPromise;
}

export function renderDryRunMessage(r: RouterResult): string {
  const modelLabel = r.model || "(default)";
  const header = `🧪 **Router Dry-Run** · ⏱ ${r.latencyMs}ms · \`${r.provider}/${modelLabel}\``;
  if (!r.ok) {
    return `${header}\n\n❌ LLM error:\n\n\`\`\`\n${r.rawText}\n\`\`\``;
  }
  if (r.json !== undefined) {
    return `${header}\n\n\`\`\`json\n${JSON.stringify(r.json, null, 2)}\n\`\`\``;
  }
  return `${header}\n\n⚠️ JSON parse failed: ${r.parseError || "unknown"}\n\n\`\`\`\n${r.rawText}\n\`\`\``;
}
