#!/usr/bin/env node
// Phase A router evaluator — hits local llama-server directly (no Electron).
//
// Goal: measure classification accuracy and per-call latency against the
// 44-sentence test set defined in docs/skill-router/test-sentences.md.
//
// Usage:  node scripts/eval-router.mjs [--endpoint http://127.0.0.1:8200] [--model Qwen3-4B-Q4_K_M.gguf] [--variant v1]
//
// Exit 0 always; we're measuring, not gating.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const ENDPOINT = args.endpoint || "http://127.0.0.1:8200/v1/chat/completions";
const MODEL = args.model || "Qwen3-4B-Q4_K_M.gguf";
const VARIANT = args.variant || "v1";

// Skill catalog — matches frontmatter of skills/music/*.md and skills/vesync/*.md
// as of 2026-04-20. When those files change, update here too.
const SKILLS = [
  {
    name: "play_music",
    category: "music",
    description: "Start playing music from user's local folder via VLC. Use when user asks to play music, a song, an artist, or a genre.",
    slots: {
      query: { type: "string", hint: "Fuzzy match: song / artist / folder / genre. Empty = shuffle everything." },
      shuffle: { type: "boolean", hint: "Default true. False only when user says 按顺序 / in order." },
    },
  },
  {
    name: "music_control",
    category: "music",
    description: "Control current VLC playback: pause/resume/next/previous/stop/volume/repeat/shuffle.",
    slots: {
      action: { type: "enum", values: ["pause", "next", "previous", "stop", "volume", "repeat", "shuffle"], hint: "pause toggles pause/resume" },
      value: { type: "any", hint: "volume: 0-100 number · repeat: 'off'|'all'|'one' · shuffle: boolean · pause/next/previous/stop: omit" },
    },
  },
  {
    name: "list_music",
    category: "music",
    description: "List available tracks. Use when user asks what music is available.",
    slots: {},
  },
  {
    name: "smart_device",
    category: "smart_home",
    description: "Control VeSync smart devices (lights/plugs/switches). For generic 开灯 pass device='灯', for 全部 pass device='全部'. Device is a FUZZY string, not a picker. Only 'list'/'on'/'off'/'toggle' — for dim/brightness use light_dim instead.",
    slots: {
      action: { type: "enum", values: ["list", "on", "off", "toggle"] },
      device: { type: "string", hint: "Fuzzy device name: specific ('灯一') or class ('灯','插座','开关','全部'). Required for on/off/toggle." },
    },
  },
  {
    name: "light_dim",
    category: "smart_home",
    description: "Set brightness (0-100) on a smart bulb. Use for 调暗/调亮/柔和 requests. 调暗→30, 调亮→80, 柔和→40, 再暗一点→20.",
    slots: {
      device: { type: "string", hint: "Fuzzy device name — same convention as smart_device." },
      level: { type: "integer", hint: "0-100. Required." },
    },
  },
  {
    name: "aircon",
    category: "climate",
    description: "Control air conditioner. on/off power, set_temp with integer °C, or mode (cool/heat/fan/auto/dry). Handler is stubbed until IR/vendor API wired — but routing here is still correct so the user gets consistent feedback.",
    slots: {
      action: { type: "enum", values: ["on", "off", "set_temp", "mode"] },
      value: { type: "any", hint: "set_temp: integer 16-30. mode: cool|heat|fan|auto|dry. Omit for on/off." },
    },
  },
  {
    name: "reminder",
    category: "system",
    description: "Create a local reminder. Fires as a system notification at the specified time.",
    slots: {
      message: { type: "string", hint: "What to remind the user about." },
      when: { type: "string", hint: "Relative '10分钟后' / absolute '15:30' / '下午3点' / '明天早上8点'." },
    },
  },
  {
    name: "app_launcher",
    category: "system",
    description: "Launch a desktop app by name. Use for '打开 XX app', '开 Chrome', '启动微信'. NOT for opening lights (smart_device) or music (play_music).",
    slots: {
      app_name: { type: "string", hint: "App name as the user said it. Pass verbatim; the main process resolves it." },
    },
  },
  {
    name: "info_query",
    category: "info",
    description: "Deterministic clock/calendar only: current time / today's date / today's weekday. DO NOT use for 天气/股价/新闻/相对日期 — those go to chat so the main LLM can answer with context.",
    slots: {
      type: { type: "enum", values: ["time", "date", "weekday"] },
    },
  },
  {
    name: "messaging",
    category: "messaging",
    description: "Send a message via wechat/email/sms. Handler is stubbed until a messaging backend is wired — route here anyway so behavior stays consistent.",
    slots: {
      platform: { type: "enum", values: ["wechat", "email", "sms"] },
      recipient: { type: "string", hint: "Name / phone / email — pass verbatim." },
      content: { type: "string", hint: "Message body. If user didn't specify, summarize their intent in one short sentence." },
    },
  },
];

// Expected values are aligned to the REAL skill schema above.
// Sentences that reference features we don't have (dim, color, alarm, flight)
// are graded as chat/unclear (graceful degradation).
const TESTS = [
  // A. 纯聊天
  { n: 1, q: "今天天气真好啊", want: { intent: "chat" } },
  { n: 2, q: "你觉得人为什么会焦虑", want: { intent: "chat" } },
  { n: 3, q: "讲个冷笑话听听", want: { intent: "chat" } },
  { n: 4, q: "我饿了", want: { intent: "chat" } },
  { n: 5, q: "什么是量子纠缠", want: { intent: "chat" } },
  { n: 6, q: "帮我想个周末计划", want: { intent: "chat" } },
  { n: 7, q: "最近睡眠不太好，有什么建议", want: { intent: "chat" } },
  { n: 8, q: "这首歌挺好听的", want: { intent: "chat" } },
  // B. 音乐
  { n: 9, q: "放首歌", want: { intent: "action", skill: "play_music" } },
  { n: 10, q: "播放周杰伦的夜曲", want: { intent: "action", skill: "play_music" } },
  { n: 11, q: "暂停", want: { intent: "action", skill: "music_control", slots: { action: "pause" } } },
  { n: 12, q: "继续播放", want: { intent: "action", skill: "music_control", slots: { action: "pause" } } },
  { n: 13, q: "循环播放", want: { intent: "action", skill: "music_control", slots: { action: "repeat" } } },
  { n: 14, q: "放第三首", want: { intent: "action", skill: "play_music" } },
  { n: 15, q: "随便放点轻音乐", want: { intent: "action", skill: "play_music" } },
  { n: 16, q: "声音大一点", want: { intent: "action", skill: "music_control", slots: { action: "volume" }, alt: ["unclear"] } },
  // C. 智能家居
  { n: 17, q: "开灯", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },
  { n: 18, q: "关掉客厅的灯", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },
  { n: 19, q: "把卧室灯调暗一点", want: { intent: "action", skill: "light_dim" } },
  { n: 20, q: "开空气净化器", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },
  { n: 21, q: "把灯光调到暖色", want: { intent: "chat", alt: ["unclear"] } },
  { n: 22, q: "关掉所有灯", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },
  { n: 23, q: "把风扇关掉", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },
  // D. 混合
  { n: 24, q: "我心情不好，想听首歌", want: { intent: "action", skill: "play_music", alt: ["chat"] } },
  { n: 25, q: "好烦，把它关了吧", want: { intent: "unclear" } },
  { n: 26, q: "灯光能不能再柔和点", want: { intent: "action", skill: "light_dim" } },
  { n: 27, q: "帮我订明天去北京的机票", want: { intent: "chat" } },
  // F. 残缺
  { n: 28, q: "那个…放个…算了", want: { intent: "unclear", alt: ["chat"] } },
  { n: 29, q: "帮我…", want: { intent: "unclear" } },
  { n: 30, q: "嗯", want: { intent: "chat" } },
  { n: 31, q: "你说呢", want: { intent: "chat" } },
  // G. 超范围（真正不在 catalog 的）
  { n: 32, q: "把空调调到 26 度", want: { intent: "action", skill: "aircon", slots: { action: "set_temp" } } },
  { n: 33, q: "给张三发个微信说我迟到了", want: { intent: "action", skill: "messaging", slots: { platform: "wechat" } } },
  { n: 34, q: "帮我打车去机场", want: { intent: "chat" } },
  { n: 35, q: "设个 7 点的闹钟", want: { intent: "action", skill: "reminder" } },
  // H. 时间/天气
  { n: 36, q: "现在几点", want: { intent: "action", skill: "info_query", slots: { type: "time" } } },
  { n: 37, q: "今天是几号", want: { intent: "action", skill: "info_query", slots: { type: "date" } } },
  { n: 38, q: "纽约现在的天气怎么样", want: { intent: "chat" } },
  { n: 39, q: "明天会下雨吗", want: { intent: "chat" } },
  { n: 40, q: "美股今天怎么样", want: { intent: "chat" } },
  // 补充
  { n: 41, q: "播放", want: { intent: "unclear" } },
  { n: 42, q: "开", want: { intent: "unclear" } },
  { n: 43, q: "把音乐关了", want: { intent: "action", skill: "music_control", slots: { action: "stop" } } },
  { n: 44, q: "开卧室灯", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },

  // === 80 条扩展语料（2026-04-20 Phase A 复核集） ===

  // A2. 纯聊天扩展（10）
  { n: 45, q: "你叫什么名字", want: { intent: "chat" } },
  { n: 46, q: "你是什么模型", want: { intent: "chat" } },
  { n: 47, q: "介绍一下你自己", want: { intent: "chat" } },
  { n: 48, q: "我今天心情有点低落", want: { intent: "chat" } },
  { n: 49, q: "最近工作压力好大", want: { intent: "chat" } },
  { n: 50, q: "你会做饭吗", want: { intent: "chat" } },
  { n: 51, q: "给我推荐一本书", want: { intent: "chat" } },
  { n: 52, q: "人生的意义是什么", want: { intent: "chat" } },
  { n: 53, q: "我该不该换工作", want: { intent: "chat" } },
  { n: 54, q: "解释一下深度学习", want: { intent: "chat" } },

  // B2. 音乐扩展（15）
  { n: 55, q: "来首周杰伦", want: { intent: "action", skill: "play_music" } },
  { n: 56, q: "播放一下最近的新歌", want: { intent: "action", skill: "play_music" } },
  { n: 57, q: "放点安静的音乐", want: { intent: "action", skill: "play_music" } },
  { n: 58, q: "放一首摇滚乐", want: { intent: "action", skill: "play_music" } },
  { n: 59, q: "切到下一首", want: { intent: "action", skill: "music_control", slots: { action: "next" } } },
  { n: 60, q: "跳过这首", want: { intent: "action", skill: "music_control", slots: { action: "next" } } },
  { n: 61, q: "回到上一首", want: { intent: "action", skill: "music_control", slots: { action: "previous" } } },
  { n: 62, q: "音量调到 50", want: { intent: "action", skill: "music_control", slots: { action: "volume" } } },
  { n: 63, q: "静音", want: { intent: "action", skill: "music_control", slots: { action: "volume" }, alt: ["unclear", "chat"] } },
  { n: 64, q: "放大声点", want: { intent: "action", skill: "music_control", slots: { action: "volume" } } },
  { n: 65, q: "单曲循环这首", want: { intent: "action", skill: "music_control", slots: { action: "repeat" } } },
  { n: 66, q: "取消循环", want: { intent: "action", skill: "music_control", slots: { action: "repeat" } } },
  { n: 67, q: "随机播放", want: { intent: "action", skill: "music_control", slots: { action: "shuffle" } } },
  { n: 68, q: "按顺序播放", want: { intent: "action", skill: "music_control", slots: { action: "shuffle" } } },
  { n: 69, q: "停止播放", want: { intent: "action", skill: "music_control", slots: { action: "stop" } } },

  // C2. 智能家居扩展（15）
  { n: 70, q: "打开书房的灯", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },
  { n: 71, q: "关上厨房的灯", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },
  { n: 72, q: "打开走廊的灯", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },
  { n: 73, q: "把阳台灯关了", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },
  { n: 74, q: "开电扇", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },
  { n: 75, q: "关掉所有插座", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },
  { n: 76, q: "开饮水机", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },
  { n: 77, q: "关加湿器", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },
  { n: 78, q: "把所有设备都关了", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },
  { n: 79, q: "看看我有哪些设备", want: { intent: "action", skill: "smart_device", slots: { action: "list" } } },
  { n: 80, q: "我都有什么音乐", want: { intent: "action", skill: "list_music" } },
  { n: 81, q: "开主卧灯和客厅灯", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },
  { n: 82, q: "把全屋灯都打开", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },
  { n: 83, q: "打开卫生间的灯", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },
  { n: 84, q: "关灯", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },

  // D2. 混合边界扩展（10）
  { n: 85, q: "帮我放首歌吧，我想静一静", want: { intent: "action", skill: "play_music", alt: ["chat"] } },
  { n: 86, q: "好累，来点轻音乐", want: { intent: "action", skill: "play_music", alt: ["chat"] } },
  { n: 87, q: "灯太亮了", want: { intent: "chat", alt: ["unclear"] } },
  { n: 88, q: "灯有点暗", want: { intent: "chat", alt: ["unclear"] } },
  { n: 89, q: "音乐太吵了", want: { intent: "action", skill: "music_control", alt: ["chat"] } },
  { n: 90, q: "背景音乐换一下", want: { intent: "action", skill: "play_music", alt: ["unclear"] } },
  { n: 91, q: "能不能把灯关一下", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },
  { n: 92, q: "帮我把音乐声音关小", want: { intent: "action", skill: "music_control", slots: { action: "volume" } } },
  { n: 93, q: "音乐听着好烦", want: { intent: "chat", alt: ["action"] } },
  { n: 94, q: "这歌真的好听，别停", want: { intent: "chat" } },

  // F2. 残缺扩展（8）
  { n: 95, q: "那个", want: { intent: "unclear" } },
  { n: 96, q: "呃…", want: { intent: "unclear", alt: ["chat"] } },
  { n: 97, q: "我想…", want: { intent: "unclear" } },
  { n: 98, q: "等等", want: { intent: "chat", alt: ["unclear"] } },
  { n: 99, q: "嗯嗯嗯", want: { intent: "chat" } },
  { n: 100, q: "哦", want: { intent: "chat" } },
  { n: 101, q: "算了", want: { intent: "chat", alt: ["unclear"] } },
  { n: 102, q: "好吧", want: { intent: "chat" } },

  // G2. 超范围扩展（10）
  { n: 103, q: "帮我订一个饭店", want: { intent: "chat", alt: ["unclear"] } },
  { n: 104, q: "查一下我的快递", want: { intent: "chat" } },
  { n: 105, q: "查我的日历", want: { intent: "chat" } },
  { n: 106, q: "提醒我下午 3 点开会", want: { intent: "action", skill: "reminder" } },
  { n: 107, q: "定个 10 分钟的计时器", want: { intent: "action", skill: "reminder" } },
  { n: 108, q: "帮我翻译一下这句话", want: { intent: "chat" } },
  { n: 109, q: "转账给张三 100 元", want: { intent: "chat" } },
  { n: 110, q: "帮我写邮件给老板", want: { intent: "action", skill: "messaging", slots: { platform: "email" } } },
  { n: 111, q: "打开网易云音乐 app", want: { intent: "action", skill: "app_launcher" } },
  { n: 112, q: "开 QQ 音乐", want: { intent: "action", skill: "app_launcher" } },

  // H2. 时间/天气/查询扩展（7）
  { n: 113, q: "上海现在几点了", want: { intent: "action", skill: "info_query", slots: { type: "time" }, alt: ["chat"] } },
  { n: 114, q: "今天星期几", want: { intent: "action", skill: "info_query", slots: { type: "weekday" } } },
  { n: 115, q: "下周一是几号", want: { intent: "chat" } },
  { n: 116, q: "北京明天最高气温多少", want: { intent: "chat" } },
  { n: 117, q: "苹果股价多少", want: { intent: "chat" } },
  { n: 118, q: "比特币现在多少钱", want: { intent: "chat" } },
  { n: 119, q: "汇率怎么查", want: { intent: "chat" } },

  // P. 礼貌/正式变体（5）
  { n: 120, q: "麻烦把灯打开", want: { intent: "action", skill: "smart_device", slots: { action: "on" } } },
  { n: 121, q: "请播放音乐", want: { intent: "action", skill: "play_music" } },
  { n: 122, q: "可以把音量调大吗", want: { intent: "action", skill: "music_control", slots: { action: "volume" } } },
  { n: 123, q: "关下客厅灯好吗", want: { intent: "action", skill: "smart_device", slots: { action: "off" } } },
  { n: 124, q: "能帮我放首歌吗", want: { intent: "action", skill: "play_music" } },
];

function buildCatalog(skills) {
  return skills
    .map((s) => {
      const slotLines = Object.entries(s.slots).map(([k, v]) => {
        const type = v.values ? `enum[${v.values.join("|")}]` : v.type;
        const hint = v.hint ? `: ${v.hint}` : "";
        return `    - ${k} (${type})${hint}`;
      });
      return [
        `- id: ${s.name}`,
        `  category: ${s.category}`,
        `  description: ${s.description}`,
        slotLines.length ? `  slots:\n${slotLines.join("\n")}` : `  slots: (none)`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildSystemPromptV1(skills) {
  return `You are the SKILL ROUTER for a Chinese-first voice assistant ("XiaoZhi").

Your ONLY job is to classify the user's single utterance into exactly ONE of:
  - chat    : conversation, opinions, info/weather/time/news, anything without a matching skill below
  - action  : a clear command that maps to a skill in the catalog
  - unclear : too fragmented or ambiguous — should ask a short follow-up

RESPOND WITH EXACTLY ONE JSON OBJECT. No prose, no markdown fences, nothing else before or after.

Schemas:
  chat    -> { "intent": "chat", "reply": "<brief natural reply in the user's language>" }
  action  -> { "intent": "action", "category": "<skill category>", "skill": "<skill id>", "slots": { ... }, "confidence": 0.0-1.0 }
  unclear -> { "intent": "unclear", "ask": "<one short clarifying question in the user's language>" }

Classification rules:
- Only emit intent=action when the utterance maps to ONE skill in the catalog with confidence >= 0.6.
- Weather, time, date, news, stocks, general facts -> intent=chat (handled by the main LLM + web search, NOT a skill).
- Ambiguous pronouns ("它", "那个", bare "关了吧") with no prior context -> intent=unclear.
- Pure fragments ("播放", "开", "嗯", "帮我…") -> intent=unclear unless they're complete one-word replies, then chat.
- Prefer chat over forcing a weak skill match.
- Keep "reply" and "ask" <= 2 sentences.

Skill catalog:
${buildCatalog(skills)}

Respond now with the JSON only.`;
}

// v2 = v1 + Qwen3 /no_think flag to disable thinking mode (massive latency/cost win
// for this classification task — we don't need chain-of-thought to emit one JSON).
function buildSystemPromptV2(skills) {
  return buildSystemPromptV1(skills) + "\n\n/no_think";
}

// v3 = v2 + hard enum/scope discipline + Chinese disambiguation table + anti-invention
// rules. Addresses the remaining 12 failures from v2 where the model invented slot
// values ('set' not in enum, 'toggle' for 空调/闹钟), confused 循环/随机, and forced
// action on evaluative sentences like "这首歌挺好听的".
function buildSystemPromptV3(skills) {
  return `You are the SKILL ROUTER for a Chinese-first voice assistant ("XiaoZhi").

Your ONLY job is to classify the user's single utterance into exactly ONE of:
  - chat    : conversation, opinions, info/weather/time/news, evaluative remarks, and ANY request whose required skill is NOT in the catalog
  - action  : a clear command that maps to a skill in the catalog with a valid slot value
  - unclear : too fragmented or ambiguous — should ask a short follow-up

RESPOND WITH EXACTLY ONE JSON OBJECT. No prose, no markdown fences, nothing before or after.

Schemas:
  chat    -> { "intent": "chat", "reply": "<brief reply in user's language>" }
  action  -> { "intent": "action", "category": "<skill category>", "skill": "<skill id>", "slots": { ... }, "confidence": 0.0-1.0 }
  unclear -> { "intent": "unclear", "ask": "<short clarifying question>" }

=== HARD RULES (DO NOT VIOLATE) ===

R1. ENUM STRICTNESS: If a slot is enum-typed and the user's intent maps to NO value in the enum,
    DO NOT invent a value. Return intent=chat (skill unavailable) or intent=unclear.
    Never emit "set", "dim", "brightness", "color" — those aren't in any enum below.

R2. SCOPE: smart_device ONLY does list/on/off/toggle on lights, plugs, switches.
    - 调暗 / 调亮 / 变柔和 / 调亮度 → intent=chat (no brightness skill)
    - 调到暖色 / 调颜色 / 换色温 → intent=chat (no color skill)
    - 空调 / 闹钟 / 机票 / 打车 / 发微信 → intent=chat (not in catalog)
    - 风扇 / 插座上的任何电器 with on/off → smart_device is fine

R3. EVALUATIVE ≠ COMMAND: "这首歌真好听" / "灯光真漂亮" are opinions, not commands.
    intent=chat.

R4. BARE VERB WITHOUT OBJECT → unclear: "开" / "关" / "播放" / "停" alone.
    But "开灯" / "关音乐" / "播放周杰伦" are complete → action.

R5. AMBIGUOUS PRONOUN ("它" / "那个" / bare "关了吧" / "把它关了" without prior context)
    → intent=unclear. Do NOT guess whether it means music or lights.

R6. INFO / CHAT QUESTIONS (weather, time, date, news, stocks, facts, advice, jokes,
    planning, emotional support) → intent=chat. Even if skill names sound related.

R7. OUT-OF-CATALOG REQUEST (flight booking, sending IM, calling a cab, setting alarm,
    reading recipes, etc.) → intent=chat with a polite "not supported" reply.
    Don't return unclear asking for details we can't use.

R8. ONE-WORD ACKNOWLEDGMENTS ("嗯" / "好" / "你说呢" / "对") → intent=chat with a natural
    short reply, NOT unclear.

=== CHINESE DISAMBIGUATION (music) ===

  暂停 / 停一下                         -> music_control, action="pause"
  继续 / 继续播放 / 接着放              -> music_control, action="pause"  (pause toggles)
  下一首 / 跳过 / 下一个                -> music_control, action="next"
  上一首 / 上一个                        -> music_control, action="previous"
  停止 / 关掉音乐 / 把音乐关了          -> music_control, action="stop"
  循环播放 / 列表循环 / 重复播放        -> music_control, action="repeat", value="all"
  单曲循环 / 重复这首                    -> music_control, action="repeat", value="one"
  取消循环                               -> music_control, action="repeat", value="off"
  随机 / 随机播放 / 打乱                -> music_control, action="shuffle", value=true
  按顺序 / 顺序播放                      -> music_control, action="shuffle", value=false
  大声点 / 声音大一点 / 音量大          -> music_control, action="volume", value=<bigger number like 80>
  小声点 / 声音小                       -> music_control, action="volume", value=<smaller number like 30>
  放XX / 播放XX / 来首XX                -> play_music, query="XX"
  随便放点 / 放首歌                     -> play_music, query="", shuffle=true

=== CHINESE DISAMBIGUATION (smart_device) ===

  开灯 / 关灯 (no room specified)       -> device="灯"
  开客厅灯 / 关卧室灯                   -> device="客厅 灯" / "卧室 灯"
  开空气净化器 / 开风扇                 -> device="空气净化器" / "风扇"
  全部打开 / 关掉所有灯                 -> device="全部" or "灯" respectively
  调暗 / 调亮 / 变色 / 换色温           -> intent=chat (skill不支持)
  空调 / 热水器温度 / 洗衣机            -> intent=chat (不在设备库)

=== CATALOG ===

${buildCatalog(skills)}

=== END ===

Respond now. JSON only. /no_think`;
}

// v4 = v3 + targeted fixes for remaining failures:
//   #12 "继续播放" — model invented action="continue". Name the forbidden values.
//   #35 "设个 7 点的闹钟" — model forced smart_device. Add 闹钟 to out-of-catalog list.
//   #41 "播放" — bare verb, model emitted play_music. Strengthen bare-verb rule
//       with exact-match examples ("播放" / "放" / "开" / "关" / "停" alone = unclear).
function buildSystemPromptV4(skills) {
  return `You are the SKILL ROUTER for a Chinese-first voice assistant ("XiaoZhi").

Your ONLY job is to classify the user's single utterance into exactly ONE of:
  - chat    : conversation, opinions, info/weather/time/news, evaluative remarks, and ANY request whose required skill is NOT in the catalog
  - action  : a clear command that maps to a skill in the catalog with a valid slot value
  - unclear : too fragmented or ambiguous — should ask a short follow-up

RESPOND WITH EXACTLY ONE JSON OBJECT. No prose, no markdown fences, nothing before or after.

Schemas:
  chat    -> { "intent": "chat", "reply": "<brief reply in user's language>" }
  action  -> { "intent": "action", "category": "<skill category>", "skill": "<skill id>", "slots": { ... }, "confidence": 0.0-1.0 }
  unclear -> { "intent": "unclear", "ask": "<short clarifying question>" }

=== HARD RULES (DO NOT VIOLATE) ===

R1. ENUM STRICTNESS — NEVER INVENT SLOT VALUES.
    The music_control.action enum is EXACTLY: pause, next, previous, stop, volume, repeat, shuffle.
    FORBIDDEN values (do not emit, ever): "continue", "resume", "play", "set", "dim", "bright",
    "brightness", "color", "on"/"off" (those are smart_device only), "toggle" (smart_device only).
    If the user's intent has no matching enum value → intent=chat or intent=unclear.
    CRITICAL: "继续" / "继续播放" / "接着放" map to action="pause" (pause toggles pause↔resume).
              DO NOT create action="continue". It does not exist.

R2. SCOPE: smart_device ONLY does list/on/off/toggle on lights, plugs, switches, fans.
    Things that LOOK like smart_device but are NOT:
    - 调暗 / 调亮 / 变柔和 / 调亮度 → intent=chat (no brightness skill)
    - 调到暖色 / 调颜色 / 换色温 → intent=chat (no color skill)
    - 空调温度 / 26 度 → intent=chat (no thermostat skill)
    - 闹钟 / 定时器 / 计时器 → intent=chat (no alarm/timer skill)
    - 机票 / 打车 / 发微信 / 查快递 → intent=chat (not in catalog)
    - 洗衣机 / 热水器 → intent=chat (not in device library)

R3. EVALUATIVE ≠ COMMAND: "这首歌真好听" / "灯光真漂亮" / "声音不错" are opinions, not commands.
    intent=chat.

R4. BARE VERB WITHOUT OBJECT → intent=unclear.
    Exact triggers: the ENTIRE utterance is one of {"开", "关", "播放", "放", "停", "开一下", "关一下"}
    with no object after it → intent=unclear, ask what to open/play/stop.
    CRITICAL: utterance "播放" alone (4 bytes) = unclear. It is NOT a request to play music.
    But "开灯" / "关音乐" / "播放周杰伦" / "放首歌" are complete → action.

R5. AMBIGUOUS PRONOUN ("它" / "那个" / bare "关了吧" / "把它关了" without prior context)
    → intent=unclear. Do NOT guess whether it means music or lights.

R6. INFO / CHAT QUESTIONS (weather, time, date, news, stocks, facts, advice, jokes,
    planning, emotional support, recipes) → intent=chat. Even if skill names sound related.

R7. OUT-OF-CATALOG REQUEST → intent=chat with a polite "I can't do that yet" reply.
    Examples that are OUT: 订机票 / 打车 / 发微信 / 设闹钟 / 设定时器 / 调亮度 / 调色温 / 空调温度
    / 查快递 / 查股票. Return chat, NOT unclear — asking for details we can't use is worse UX.

R8. ONE-WORD ACKNOWLEDGMENTS ("嗯" / "好" / "你说呢" / "对" / "行") → intent=chat.

R9. REQUEST PHRASED AS MOOD/WISH still counts as command if the object is clear:
    "我心情不好，想听首歌" / "给我来点音乐吧" → action=play_music (with reasonable slots).
    The emotional prefix does not change the underlying command.

=== CHINESE DISAMBIGUATION (music) ===

  暂停 / 停一下                         -> music_control, action="pause"
  继续 / 继续播放 / 接着放              -> music_control, action="pause"  (pause TOGGLES — same action)
  下一首 / 跳过 / 下一个                -> music_control, action="next"
  上一首 / 上一个                        -> music_control, action="previous"
  停止 / 关掉音乐 / 把音乐关了          -> music_control, action="stop"
  循环播放 / 列表循环 / 重复播放        -> music_control, action="repeat", value="all"
  单曲循环 / 重复这首                    -> music_control, action="repeat", value="one"
  取消循环                               -> music_control, action="repeat", value="off"
  随机 / 随机播放 / 打乱                -> music_control, action="shuffle", value=true
  按顺序 / 顺序播放                      -> music_control, action="shuffle", value=false
  大声点 / 声音大一点 / 音量大          -> music_control, action="volume", value=80
  小声点 / 声音小                       -> music_control, action="volume", value=30
  放XX / 播放XX / 来首XX                -> play_music, query="XX"
  随便放点 / 放首歌 / 想听首歌           -> play_music, query="", shuffle=true
  (bare) 播放 / 放 / 停                 -> intent=unclear  (ask what song / what to stop)

=== CHINESE DISAMBIGUATION (smart_device) ===

  开灯 / 关灯 (no room specified)       -> device="灯"
  开客厅灯 / 关卧室灯                   -> device="客厅 灯" / "卧室 灯"
  开空气净化器 / 开风扇 / 关风扇        -> device="空气净化器" / "风扇"
  全部打开 / 关掉所有灯                 -> device="全部" or "灯" respectively
  调暗 / 调亮 / 变色 / 换色温           -> intent=chat (skill不支持)
  空调温度 / 闹钟 / 定时器              -> intent=chat (不在设备库)

=== CATALOG ===

${buildCatalog(skills)}

=== END ===

Respond now. JSON only. /no_think`;
}

// v5 = v4 + R4 regression fix: "暂停" / "继续" / "下一首" are complete compound
// verbs, not bare verbs — they unambiguously map to music_control. The bare-verb
// bucket is ONLY single-char verbs without context.
function buildSystemPromptV5(skills) {
  return buildSystemPromptV4(skills).replace(
    `R4. BARE VERB WITHOUT OBJECT → intent=unclear.
    Exact triggers: the ENTIRE utterance is one of {"开", "关", "播放", "放", "停", "开一下", "关一下"}
    with no object after it → intent=unclear, ask what to open/play/stop.
    CRITICAL: utterance "播放" alone (4 bytes) = unclear. It is NOT a request to play music.
    But "开灯" / "关音乐" / "播放周杰伦" / "放首歌" are complete → action.`,
    `R4. BARE VERB WITHOUT OBJECT → intent=unclear.
    UNCLEAR set (whole utterance is exactly one of these, with no other content):
      {"开", "关", "播放", "放", "停", "开一下", "关一下"}
    These are ambiguous — could be music or smart_device or something else. Ask.

    COMPLETE set (these are standalone commands and ARE action, NOT unclear):
      {"暂停", "继续", "继续播放", "下一首", "上一首", "停止", "随机播放", "循环播放",
       "大声点", "小声点"} → music_control with the matching action.
      {"开灯", "关灯", "关音乐", "播放周杰伦", "放首歌", "随便放点"} → action.

    Rule: the UNCLEAR set is a closed list of single-word ambiguous verbs.
    ANY 2+ character verb OR any verb+object combination is COMPLETE, not bare.`
  );
}

// v6 = v5 + 3 targeted fixes from 124-sentence human review:
//   #48 「我今天心情有点低落」— 纯情绪被误判成 action/play_music。收紧 R9：
//        情绪要推出 action，必须同时有"动作词 + catalog 内对象"。纯情绪 → chat。
//   #91 「能不能把灯关一下」— 礼貌婉转式完整命令被误判 unclear。新增 R10：
//        能不能/可以/麻烦/请 是礼貌前缀，不改变完整命令 → action。
//   #94 「这歌真的好听，别停」— 正面评价+「别停」被理解成命令 action=pause。
//        新增 R11：评价/愿望式否定动词（别停/不要停）= chat（愿望）不是命令。
function buildSystemPromptV6(skills) {
  const v5 = buildSystemPromptV5(skills);

  // Replace R9 with a stricter version requiring BOTH action word + catalog object.
  const newR9 = `R9. 情绪/心情类语句 → 默认 chat，除非同时满足两个条件才算 action：
    (a) 句中含明确的动作词（想听 / 来点 / 放 / 播放 / 关 / 开 / 调 …），且
    (b) 该动作对象在 catalog 里（歌 / 音乐 / 灯 / 风扇 / 插座 …）。

    示例：
    - "我今天心情有点低落" → chat（只有情绪，没有动作词，没有对象）
    - "最近压力好大" → chat
    - "我心情不好，想听首歌" → action/play_music（情绪 + 动作"听" + 对象"歌"）
    - "好累，给我来点轻音乐" → action/play_music（情绪 + 动作"来点" + 对象"轻音乐"）
    - "无聊死了" → chat（只有情绪）

    不要为了"有用"而从纯情绪里脑补点歌/开灯。让用户自己说出动作词。

R10. 礼貌/婉转前缀不改变命令本质：
    "能不能X" / "可以X吗" / "麻烦X" / "请X" / "帮我X" / "X好吗" / "X一下"
    —— 前缀只是语气，剥掉后若是完整命令就按 action 分类。
    - "能不能把灯关一下" → action/smart_device {action:"off", device:"灯"}（不是 unclear）
    - "可以把音量调大吗" → action/music_control {action:"volume"}
    - "麻烦把灯打开" → action/smart_device {action:"on", device:"灯"}
    - "关下客厅灯好吗" → action/smart_device {action:"off", device:"客厅 灯"}

R11. 评价/愿望式的否定动词 ≠ 反向命令：
    正面评价 + "别停" / "不要停" / "继续" 的组合，是"希望当前状态延续"的愿望表达，
    不是要求模型去执行某个动作 → 返回 chat。
    - "这歌真的好听，别停" → chat（表达享受，不是 action=pause）
    - "这灯不错，别关" → chat
    对比："请暂停" / "停一下" → 仍然是 action（直接命令，无评价上下文）。`;

  return v5.replace(
    `R9. REQUEST PHRASED AS MOOD/WISH still counts as command if the object is clear:
    "我心情不好，想听首歌" / "给我来点音乐吧" → action=play_music (with reasonable slots).
    The emotional prefix does not change the underlying command.`,
    newR9
  );
}

// v7 = v6 + R2 anti-substitution fix for #19「把卧室灯调暗一点」：
//   v6 模型违反 R2，把「调暗」硬塞成 action="toggle"（toggle 是 on↔off 的切换，
//   根本不是调暗）。在 R2 中显式加一条：若用户想要的操作是 dim/color/temperature
//   而 catalog 只有 on/off/toggle，**不许**用 toggle 代替 —— 直接 chat。
function buildSystemPromptV7(skills) {
  const v6 = buildSystemPromptV6(skills);

  const newR2Block = `R2. SCOPE: smart_device ONLY does list/on/off/toggle on lights, plugs, switches, fans.
    Things that LOOK like smart_device but are NOT:
    - 调暗 / 调亮 / 变柔和 / 调亮度 → intent=chat (no brightness skill)
    - 调到暖色 / 调颜色 / 换色温 → intent=chat (no color skill)
    - 空调温度 / 26 度 → intent=chat (no thermostat skill)
    - 闹钟 / 定时器 / 计时器 → intent=chat (no alarm/timer skill)
    - 机票 / 打车 / 发微信 / 查快递 → intent=chat (not in catalog)
    - 洗衣机 / 热水器 → intent=chat (not in device library)

    ANTI-SUBSTITUTION（关键）：如果用户想要的操作是「调节」类（调暗/调亮/调色/调温/
    调柔和/调节亮度/调节色温），而 smart_device.action enum 只有 list/on/off/toggle，
    **绝对不许**用 "toggle" 或 "on"/"off" 去假装执行「调节」。toggle 只是 on↔off 的
    切换，它不等于调暗，也不等于调色。
    - "把卧室灯调暗一点" → intent=chat（没有 dim skill，不要返回 toggle）
    - "灯再柔和点" → intent=chat
    - "把空调调到 26 度" → intent=chat
    - 宁可返回 chat 说明"暂不支持"，也不要用错误的 action 欺骗用户。`;

  return v6.replace(
    `R2. SCOPE: smart_device ONLY does list/on/off/toggle on lights, plugs, switches, fans.
    Things that LOOK like smart_device but are NOT:
    - 调暗 / 调亮 / 变柔和 / 调亮度 → intent=chat (no brightness skill)
    - 调到暖色 / 调颜色 / 换色温 → intent=chat (no color skill)
    - 空调温度 / 26 度 → intent=chat (no thermostat skill)
    - 闹钟 / 定时器 / 计时器 → intent=chat (no alarm/timer skill)
    - 机票 / 打车 / 发微信 / 查快递 → intent=chat (not in catalog)
    - 洗衣机 / 热水器 → intent=chat (not in device library)`,
    newR2Block
  );
}

// v8 = Phase B catalog expansion. 6 new skills are now available:
//   light_dim    — dim/brighten lights (was always chat in v7)
//   aircon       — on/off/temp/mode for AC (was chat)
//   reminder     — schedule local notification (was chat)
//   app_launcher — open desktop apps (was chat)
//   info_query   — time / date / weekday (was chat; weather/stock still usually chat)
//   messaging    — send wechat / email / sms (was chat; stubbed)
// Rewrites R2 to remove "no dim skill" language, adds R12 for the new
// router-aware disambiguation rules, and expands the Chinese mappings.
function buildSystemPromptV8(skills) {
  return `You are the SKILL ROUTER for a Chinese-first voice assistant ("XiaoZhi").

Your ONLY job is to classify the user's single utterance into exactly ONE of:
  - chat    : conversation, opinions, evaluative remarks, open-ended advice, and ANY request whose required skill is NOT in the catalog
  - action  : a clear command that maps to a skill in the catalog with valid slot values
  - unclear : too fragmented or ambiguous — should ask a short follow-up

RESPOND WITH EXACTLY ONE JSON OBJECT. No prose, no markdown fences, nothing before or after.

Schemas:
  chat    -> { "intent": "chat", "reply": "<brief reply in user's language>" }
  action  -> { "intent": "action", "category": "<skill category>", "skill": "<skill id>", "slots": { ... }, "confidence": 0.0-1.0 }
  unclear -> { "intent": "unclear", "ask": "<short clarifying question>" }

=== HARD RULES (DO NOT VIOLATE) ===

R1. ENUM STRICTNESS — NEVER INVENT SLOT VALUES.
    music_control.action enum: pause, next, previous, stop, volume, repeat, shuffle.
    smart_device.action enum: list, on, off, toggle.
    aircon.action enum: on, off, set_temp, mode.
    info_query.type enum: time, date, weekday, weather, stock, news.
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

    Info queries (info_query skill exists now):
    - 现在几点 / 现在是几点  → info_query (type=time)
    - 今天几号 / 今天日期  → info_query (type=date)
    - 今天星期几  → info_query (type=weekday)
    - X天气 / 股价 / 新闻  → info_query still accepted but these return "not wired";
                         prefer chat if the user wants a real answer

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

R7. OUT-OF-CATALOG still exists for things we truly can't do:
    订机票 / 打车 / 翻译 / 转账 / 查快递  → intent=chat (no skill for these).
    Return chat, NOT unclear.

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

R12. 混合意图 — 用户一句话含多个命令时选最主要的：
    "开灯然后放首歌" → 拆不了，暂选第一个（smart_device on=灯）。
    复合真的两步的事，回 unclear 问他们想先做哪个。

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

  开灯 / 关灯 (no room)                 -> smart_device, device="灯"
  开客厅灯 / 关卧室灯                   -> smart_device, device="客厅 灯" / "卧室 灯"
  开空气净化器 / 开风扇 / 关风扇        -> smart_device
  全部打开 / 关掉所有灯                 -> smart_device, device="全部"|"灯"
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
  下周一是几号 / 后天星期几              -> chat (info_query 无相对日期计算)
  天气怎么样 / X 的天气                 -> info_query, type="weather", target=X (或 chat)
  X 的股价 / 美股                       -> chat (info_query 无股票数据)

=== CHINESE DISAMBIGUATION (messaging) ===

  给X发微信说Y / 微信告诉X Y            -> messaging, platform="wechat", recipient=X, content=Y
  发邮件给X 主题Y                        -> messaging, platform="email", recipient=X
  发短信 / 发条消息                      -> messaging, platform="sms"

=== CATALOG ===

${buildCatalog(skills)}

=== END ===

Respond now. JSON only. /no_think`;
}

// v9 = v8 + regressions from first v8 eval (87.9%, 15 failures). Fixes:
//   #38/39/40/116/117/118 天气/股价 drift — info_query enum narrowed to
//     time/date/weekday only (weather/stock/news removed from both skill
//     markdown and prompt). Weather/stock/news → chat.
//   #108 「帮我翻译」 → messaging drift — R7 now explicitly lists 翻译
//     as out-of-catalog, and messaging disambiguation adds negative examples.
//   #71 #91 #123 「关X灯」→ toggle regression — R2 smart_device section
//     now has a 关/off anti-substitution note and explicit off examples.
//   #115 「下周一是几号」→ model emitted intent:"info" (invalid) — intent
//     whitelist restated in the schema block as an enum.
//   #105 「查我的日历」→ unclear — added to R7 out-of-catalog list.
function buildSystemPromptV9(skills) {
  const v8 = buildSystemPromptV8(skills);

  // Surgical fixes. Each replace targets a specific v8 block.
  let v9 = v8;

  // 1. Restate schema as enum to prevent model inventing "info" as intent.
  v9 = v9.replace(
    `Your ONLY job is to classify the user's single utterance into exactly ONE of:
  - chat    : conversation, opinions, evaluative remarks, open-ended advice, and ANY request whose required skill is NOT in the catalog
  - action  : a clear command that maps to a skill in the catalog with valid slot values
  - unclear : too fragmented or ambiguous — should ask a short follow-up`,
    `Your ONLY job is to classify the user's single utterance into exactly ONE of these THREE intent values (closed enum — never invent others like "info", "query", "system"):
  - "chat"    : conversation, opinions, evaluative remarks, open-ended advice, weather/stock/news/facts, and ANY request whose required skill is NOT in the catalog
  - "action"  : a clear command that maps to a skill in the catalog with valid slot values
  - "unclear" : too fragmented or ambiguous — should ask a short follow-up`
  );

  // 2. Drop weather/stock/news from info_query enum.
  v9 = v9.replace(
    `    info_query.type enum: time, date, weekday, weather, stock, news.`,
    `    info_query.type enum: time, date, weekday. (NO weather/stock/news — those go to chat.)`
  );

  // 3. Rewrite info_query section of R2.
  v9 = v9.replace(
    `    Info queries (info_query skill exists now):
    - 现在几点 / 现在是几点  → info_query (type=time)
    - 今天几号 / 今天日期  → info_query (type=date)
    - 今天星期几  → info_query (type=weekday)
    - X天气 / 股价 / 新闻  → info_query still accepted but these return "not wired";
                         prefer chat if the user wants a real answer`,
    `    Info queries (info_query skill — narrow: clock/calendar only):
    - 现在几点 / 现在是几点  → info_query (type=time)
    - 今天几号 / 今天日期  → info_query (type=date)
    - 今天星期几  → info_query (type=weekday)
    - 天气 / 股价 / 新闻 / 下周一是几号 / 相对日期  → intent=chat
      (info_query has NO weather/stock/news/relative-date — those need the main LLM)`
  );

  // 4. Drop info_query disambiguation rows for weather/stock.
  v9 = v9.replace(
    `  现在几点 / 几点了                      -> info_query, type="time"
  今天几号 / 今天日期                    -> info_query, type="date"
  今天星期几                             -> info_query, type="weekday"
  下周一是几号 / 后天星期几              -> chat (info_query 无相对日期计算)
  天气怎么样 / X 的天气                 -> info_query, type="weather", target=X (或 chat)
  X 的股价 / 美股                       -> chat (info_query 无股票数据)`,
    `  现在几点 / 几点了                      -> info_query, type="time"
  今天几号 / 今天日期                    -> info_query, type="date"
  今天星期几                             -> info_query, type="weekday"
  下周一是几号 / 后天星期几              -> intent=chat (没有相对日期计算)
  天气 / 下雨吗 / 最高气温               -> intent=chat (info_query 不处理天气)
  股价 / 比特币多少钱 / 美股             -> intent=chat (info_query 不处理股票)
  新闻 / 头条                            -> intent=chat`
  );

  // 5. Strengthen R7 with translation + calendar additions.
  v9 = v9.replace(
    `R7. OUT-OF-CATALOG still exists for things we truly can't do:
    订机票 / 打车 / 翻译 / 转账 / 查快递  → intent=chat (no skill for these).
    Return chat, NOT unclear.`,
    `R7. OUT-OF-CATALOG — intent=chat (NOT unclear, NOT any other skill):
    订机票 / 打车 / 转账 / 查快递 / 查日历  → chat
    翻译 / translate  → chat (messaging is NOT for translation)
    天气 / 股价 / 新闻  → chat (info_query is NOT for these)
    下周一是几号 / 明天星期几  → chat (no relative-date calc skill)`
  );

  // 6. Reinforce 关 = off not toggle.
  v9 = v9.replace(
    `  开灯 / 关灯 (no room)                 -> smart_device, device="灯"
  开客厅灯 / 关卧室灯                   -> smart_device, device="客厅 灯" / "卧室 灯"
  开空气净化器 / 开风扇 / 关风扇        -> smart_device
  全部打开 / 关掉所有灯                 -> smart_device, device="全部"|"灯"`,
    `  开灯                                  -> smart_device, action="on", device="灯"
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
            toggle 只用于用户明确说"切换"或"反一下"的场景。`
  );

  // 7. Add a negative example to messaging disambiguation for translation.
  v9 = v9.replace(
    `  给X发微信说Y / 微信告诉X Y            -> messaging, platform="wechat", recipient=X, content=Y
  发邮件给X 主题Y                        -> messaging, platform="email", recipient=X
  发短信 / 发条消息                      -> messaging, platform="sms"`,
    `  给X发微信说Y / 微信告诉X Y            -> messaging, platform="wechat", recipient=X, content=Y
  发邮件给X 主题Y                        -> messaging, platform="email", recipient=X
  发短信 / 发条消息                      -> messaging, platform="sms"
  翻译 / 帮我翻译 / translate            -> intent=chat (messaging is NOT for translation)
  写一段代码 / 帮我写文档                 -> intent=chat (messaging is NOT a text-gen skill)`
  );

  return v9;
}

const PROMPT_VARIANTS = {
  v1: buildSystemPromptV1,
  v2: buildSystemPromptV2,
  v3: buildSystemPromptV3,
  v4: buildSystemPromptV4,
  v5: buildSystemPromptV5,
  v6: buildSystemPromptV6,
  v7: buildSystemPromptV7,
  v8: buildSystemPromptV8,
  v9: buildSystemPromptV9,
};

function extractJson(raw) {
  const trimmed = raw.trim().replace(/^```(?:json|jsonc)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(trimmed); } catch {}
  const first = trimmed.indexOf("{");
  if (first < 0) return null;
  let depth = 0, inStr = false, esc = false;
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
        try { return JSON.parse(trimmed.slice(first, i + 1)); } catch { return null; }
      }
    }
  }
  // Unclosed JSON (truncation or premature stop) — try auto-closing.
  if (depth > 0) {
    let repaired = trimmed.slice(first);
    if (inStr) repaired += '"';
    repaired += "}".repeat(depth);
    try { return JSON.parse(repaired); } catch { return null; }
  }
  return null;
}

async function callRouter(systemPrompt, userText) {
  const t0 = performance.now();
  let res, data, err;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        temperature: 0.1,
        max_tokens: 768,
      }),
    });
    data = await res.json();
  } catch (e) {
    err = e;
  }
  const latency = Math.round(performance.now() - t0);
  if (err) return { raw: `ERR: ${err.message}`, latency };
  const raw = data?.choices?.[0]?.message?.content || JSON.stringify(data);
  return { raw, latency };
}

function grade(want, json) {
  if (!json || typeof json !== "object") return { pass: false, reason: "no-json" };
  const gotIntent = json.intent;
  const altOk = Array.isArray(want.alt) && want.alt.includes(gotIntent);
  if (gotIntent !== want.intent && !altOk) {
    return { pass: false, reason: `intent=${gotIntent} want=${want.intent}${want.alt ? `|${want.alt.join(",")}` : ""}` };
  }
  if ((gotIntent === "action") && want.intent === "action") {
    if (json.skill !== want.skill) {
      return { pass: false, reason: `skill=${json.skill} want=${want.skill}` };
    }
    if (want.slots) {
      const gotSlots = json.slots || {};
      for (const [k, v] of Object.entries(want.slots)) {
        if (gotSlots[k] !== v) {
          return { pass: false, reason: `slot.${k}=${gotSlots[k]} want=${v}` };
        }
      }
    }
  }
  return { pass: true };
}

async function main() {
  const buildPrompt = PROMPT_VARIANTS[VARIANT];
  if (!buildPrompt) {
    console.error(`Unknown variant: ${VARIANT}. Available: ${Object.keys(PROMPT_VARIANTS).join(", ")}`);
    process.exit(1);
  }
  const systemPrompt = buildPrompt(SKILLS);

  console.log(`# Router eval run · variant=${VARIANT} · model=${MODEL} · endpoint=${ENDPOINT}`);
  console.log(`# ${TESTS.length} sentences · ${new Date().toISOString()}\n`);

  const rows = [];
  let pass = 0;
  const latencies = [];
  for (const t of TESTS) {
    const { raw, latency } = await callRouter(systemPrompt, t.q);
    latencies.push(latency);
    const json = extractJson(raw);
    const result = grade(t.want, json);
    if (result.pass) pass++;
    rows.push({ ...t, raw, json, latency, result });
    const mark = result.pass ? "PASS" : "FAIL";
    const js = json ? JSON.stringify(json) : `RAW: ${raw.slice(0, 120)}`;
    console.log(`[${String(t.n).padStart(2, " ")}] ${mark} ${String(latency).padStart(5)}ms · ${t.q}`);
    console.log(`      got: ${js}`);
    if (!result.pass) console.log(`      reason: ${result.reason}`);
  }

  latencies.sort((a, b) => a - b);
  const avg = Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];

  console.log(`\n# Summary`);
  console.log(`# accuracy: ${pass}/${TESTS.length} (${((pass / TESTS.length) * 100).toFixed(1)}%)`);
  console.log(`# latency ms: min=${latencies[0]} p50=${p50} avg=${avg} p95=${p95} max=${latencies[latencies.length - 1]}`);

  // Emit machine-readable JSON for later analysis
  const outPath = `docs/skill-router/run-${VARIANT}-${new Date().toISOString().slice(0, 10)}.json`;
  const fs = await import("node:fs");
  fs.writeFileSync(outPath, JSON.stringify({ variant: VARIANT, model: MODEL, endpoint: ENDPOINT, pass, total: TESTS.length, latencies: { min: latencies[0], p50, avg, p95, max: latencies[latencies.length - 1] }, rows }, null, 2));
  console.log(`# details -> ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
