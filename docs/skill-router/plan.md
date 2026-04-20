# Router + Skill 库架构（第一版，不含 workflow）

> 本文件 = 已通过的架构方案。实施时按 [`test-method.md`](test-method.md) 的节奏逐阶段推进。

## Context

当前 XiaoZhi 的 agent 交互完全走自然语言 → LLM，碰到日常重复性操作（放歌、开灯、查日历）
误差偏大、延迟也不必要地长。将"聊天"与"执行"明确分流：

- **聊天**：继续走 LLM 自然回复
- **行动**：LLM 把用户意图抽成**结构化表格**（category + slots），由代码确定性执行

既利用 LLM 的语言理解，又用结构化数据保证执行端不出幺蛾子。本次**不做 workflow 库**
（多 skill 串联留给下一版），聚焦 router + skill + TTS 反馈规范。

### 关键约束（已与用户对齐）

1. UI 完全复用现有"语音/文字 → 输入框 → 自动提交"流程，不另起通道
2. router 走**单次 LLM 调用**输出结构化 JSON（chat 回复 / action 表格 / unclear 反问），不要两段式
3. skill 定义用 **JSON schema 文件**，每个 skill 一个文件；执行体用配套的 handler 代码
4. TTS 反馈三档：**silent（只放提示音）/ brief（固定短句）/ full（LLM 口播）**，每个 skill 声明默认档
5. TTS 打断**只认"小智"唤醒词** + 按键/点击兜底；绝不做通用关键词停嘴（避免 TTS 自触发）

## 重大发现：骨架已存在

`src/services/skills/` 已有：
- `skillLoader.ts:128` — `loadAllSkills()` 加载用户/内置 skills
- `skillExecutor.ts` — 已有 passthrough / commentary / template 三种 responseMode
- `handlers/music.ts`、`handlers/vesync.ts` — 两个示例 handler

所以本次是**扩展**，不是**重建**。三档 TTS 策略可复用/映射到已有的 responseMode：

| 本次设计 | 已有 responseMode | 说明 |
| --- | --- | --- |
| silent | passthrough（无 TTS）| 只放提示音 |
| brief  | template           | handler 返回现成短句 |
| full   | commentary         | 结果给 LLM 生成自然口播 |

实施时确认语义对齐；不齐就在 executor 加映射层，别改现有字段名。

## 架构

```
用户输入（语音转文字 或 直接键入）
        ↓
[ChatInput.handleSubmit]  (src/components/chat/ChatInput.tsx:61)
        ↓
[useChatStreaming.sendToAI]  (src/components/chat/useChatStreaming.ts:116)  ← 注入点
        ↓
┌─────────────────────────────────────────┐
│  Router LLM 单次调用                     │
│  system prompt: 现有 agent prompt        │
│    + 所有 skill schema                   │
│    + status log (近 5 条)                │
│  要求输出结构化 JSON:                    │
│  {intent: chat|action|unclear, ...}      │
└─────────────────────────────────────────┘
        ↓
   ┌────┴─────┬──────────┐
   chat     action     unclear
   ↓          ↓           ↓
  显示     skill       追问
  回复    dispatch    一句
           ↓
      handler 执行
           ↓
      {tts_policy, tts_text?, data?}
           ↓
      TTS 三档处理
           ↓
      更新 status log
```

## 关键文件改动

| 文件 | 改动 |
| --- | --- |
| `src/config/prompts.ts:171` `getAgentSystemPrompt()` | 拼入 skill schema 目录 + status log 片段 + 输出格式硬约束 |
| `src/components/chat/useChatStreaming.ts:116` `sendToAI()` | 流式返回后解析 JSON；chat → 照常显示；action → dispatch skill；unclear → 直接回问句 |
| `src/services/skills/skillLoader.ts:128` | schema 加 `category`、`tts_policy` 默认、`slot_spec` 字段（已有则复用） |
| `src/services/skills/skillExecutor.ts` | 从 router JSON 取 `{category, slots}` → 找 handler → 执行 → 统一返回 `{status, tts_policy, tts_text?, data?}` |
| `src/helpers/ttsManager.js` | 新增 `speakByPolicy(result)`：silent 播 cue 音效、brief 直读、full 调 LLM 口播 |
| `src/components/chat/AgentOverlay.tsx:133` `speakAssistant()` | 改走 `speakByPolicy`；监听小智唤醒词中断（调用 `ttsManager.stop()`）|
| `src/services/skills/statusLog.ts`（**新文件**）| 滚动窗口状态日志，5–10 条，`append()` / `render()` |
| `src/skills/*.json`（**新目录**）| 内置 skill schema；用户目录（`userData/skills/`）覆盖/扩展 |
| `resources/sounds/cue-*.wav`（**新资源**）| silent 档提示音（至少 ok / error 两个）|

## 数据契约

### Router LLM 输出

```jsonc
// chat
{ "intent": "chat", "reply": "..." }

// action
{
  "intent": "action",
  "confidence": 0.0-1.0,
  "category": "music",         // 必须命中某个 skill 的 category
  "skill": "music.play",       // skill id
  "slots": { "song": "XXX" },  // 允许空；空槽位由 handler 走默认行为
  "tts_override": null         // 可选：覆盖 skill 默认 tts_policy
}

// unclear
{ "intent": "unclear", "ask": "你是想让我放歌吗？" }
```

### Skill schema（JSON 文件）

```jsonc
{
  "id": "music.play",
  "category": "music",
  "description": "播放音乐",
  "tts_policy": "brief",
  "slots": {
    "song":   { "type": "string", "default": null, "hint": "歌曲名，为空则随机" },
    "artist": { "type": "string", "default": null },
    "index":  { "type": "number", "default": null, "hint": "第几首" }
  },
  "examples": ["放首歌", "放周杰伦", "播放下一首"]
}
```

### Handler 返回契约

```ts
type HandlerResult = {
  status: "ok" | "error";
  tts_policy: "silent" | "brief" | "full";  // 错误时最少 brief
  tts_text?: string;                         // brief 用
  data?: unknown;                            // full 用：LLM 转口播
};
```

### Status log 渲染格式

```
[状态]
active: music.play (song="XXX", 激活于 12s 前)
[近期动作]
- 12s 前:  music.play      → ok
- 2min 前: lights.on(客厅)  → ok
- 5min 前: chat
```

滚动 5–10 条；`render()` 结果直接拼进 router system prompt。

## TTS 打断设计

1. TTS 播放期间，`wakeWordManager` 保持常开（本来就是常开）
2. 检测到"小智" → 立刻 `ttsManager.stop()` + 进入听指令状态
3. 任意键 / 点击悬浮球也能 `stop()` 作兜底
4. **自触发防护**：full 模式 LLM 生成口播文本后，扫一遍；若含"小智"则替换为"助手"，
   或在播放该片段时临时禁用 KWS 2 秒

## 明确不做（留下一版）

- workflow 库（多 skill 串联、条件分支、skill 间传参）
- skill 热重载 UI（先手动重启生效）
- 多语言 skill 描述（先中文）
- skill 权限 / 用户授权提示（敏感操作直接阻断，等到做的时候再加）

## 开放风险（实施时决策）

- **router 模型选型**：Haiku 4.5 / Gemini 3 Flash 够不够胜任复杂 chat？
  若用户反馈 chat 变笨，允许"聊天走大模型、路由走快模型"两段式作为 fallback
- **现有 responseMode 与 silent/brief/full 的语义差**：实现时发现映射不干净，
  就在 executor 加一层转换，不改现有字段名
- **skill 冲突**：两个 skill 可能都自称 `category=music`；loader 需要去重报错
