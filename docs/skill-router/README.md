# Skill Router 改造 · 工作入口

> 这个目录是 XiaoZhi 的下一步改造：给 agent 加一个 **router**，把用户的自然语言先分流为
> **chat / action / unclear**，action 再按 **JSON schema 填表 → handler 执行**，
> TTS 反馈分 **silent / brief / full** 三档。

## 给 AI 助手的阅读顺序

1. **先读本文件**——了解现状、进度、待办
2. [`plan.md`](plan.md) — 架构方案（已与用户对齐）
3. [`test-method.md`](test-method.md) — 分阶段验证方法（**重点**：每阶段先 dry-run 拦截输出，用户确认后才放行）
4. [`test-sentences.md`](test-sentences.md) — 30 条测试句及预期分类（用户定稿版）

读完后**直接进入当前阶段**，不要从头再讨论架构。

## 当前进度

**状态**：计划已通过，代码未动。**起点** = 阶段 A（router dry-run）。

- [ ] 阶段 A：`useChatStreaming.sendToAI` 加 dry-run 开关 + 调试气泡显示 router JSON
- [ ] 阶段 A 验证：跑完 30 条测试句，用户逐条检查 `intent / category / skill / slots`
- [ ] 阶段 B：同步骤已在 A 内（slots 就在 JSON 里）
- [ ] 阶段 C：放行 music.play 执行；其它 skill 仍 dry-run
- [ ] 阶段 D：TTS 三档 + 小智唤醒词打断
- [ ] workflow 库（单独一版，本次不做）

## 关键约束（不要跨越）

1. **UI 完全复用现有输入框流程**（`voice → ChatInput → auto-submit`），不另起通道
2. **router = 单次 LLM 调用**，输出一个 JSON（chat 回复 / action 表 / unclear 反问），不做两段式
3. skill 用 **JSON schema 文件**，和 handler 代码配对；参考已有的 `src/services/skills/handlers/music.ts`、`vesync.ts`
4. **TTS 打断只认"小智"唤醒词 + 按键/点击兜底**，绝不做通用关键词停嘴
5. **每阶段先 dry-run / 拦截输出**，用户验完才放行（见 `test-method.md`）

## 关键代码位置（实施时参考）

| 文件 | 作用 |
| --- | --- |
| `src/config/prompts.ts:171` `getAgentSystemPrompt()` | 拼 router system prompt + skill schema + status log |
| `src/components/chat/useChatStreaming.ts:116` `sendToAI()` | **主要注入点**：dry-run 开关、JSON 解析、分流 |
| `src/components/chat/ChatInput.tsx:61` `handleSubmit()` | 输入入口，不改 |
| `src/components/chat/AgentOverlay.tsx:133` `speakAssistant()` | TTS 入口，阶段 D 改 |
| `src/services/skills/skillLoader.ts:128` | 扩展 schema 字段 |
| `src/services/skills/skillExecutor.ts` | 统一 handler 返回契约 |
| `src/helpers/ttsManager.js` | 阶段 D 加 `speakByPolicy` |
| `src/helpers/wakeWordManager.js` | 阶段 D：KWS 命中时打断 TTS |

## 用户协作偏好（请务必遵守）

- **大/有风险改动默认分阶段 + dry-run 闸**；小修小补正常推进
- **不要自己脑补架构决定**，按本目录 `plan.md` 来；有偏差先问
- **每阶段产出先给用户看输出再动执行**，参考 `test-method.md`
- 聊天/文档用中文，代码注释按项目现有风格
