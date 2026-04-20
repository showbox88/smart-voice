# 分阶段验证方法（Gated Validation）

> 这是本次改造的核心工作节奏。**每阶段先拦截输出让用户看，用户确认后才放行到下一阶段**。
> 见 [`test-sentences.md`](test-sentences.md) 作为测试语料。

## 为什么要这样

LLM 做分类/抽取/路由时，**输出不是代码能一眼看出对错的**。
如果先把执行接上再发现分类有 20% 错，已经关错灯、放错歌了。
稳妥做法：先把 router 的 JSON 拦下来看，一批样本过一遍，错的改 prompt 或改 schema，
全对了再放行到执行。

## 节奏

### 阶段 A · Router Dry-Run（**起点**）

**目标**：验证 router 的 JSON 输出——意图分类对不对、槽位填得准不准。

**怎么做**：
1. 在 `src/components/chat/useChatStreaming.ts:116` `sendToAI()` 里加一个 dry-run 开关
   - 实现方式任选：env 变量 `SKILL_ROUTER_DRYRUN=1` / localStorage 标志 / 设置面板开关
   - 开发期最省事的：临时写个常量 `const DRY_RUN = true`
2. 扩展 `getAgentSystemPrompt()`（`src/config/prompts.ts:171`），拼入：
   - 所有已加载 skill 的 schema（精简版：id / category / description / slots / examples）
   - 输出格式硬约束：**必须输出合法 JSON，不要前后缀，不要 markdown**
   - status log 暂可先跳过（阶段 A 不测上下文，留 context 相关的 4 条放到阶段 A 后期再开）
3. 开关开启时：
   - **不调用 skillExecutor**
   - 把 router 的 JSON **原样打印到聊天气泡里**（代码块格式，用户一眼看清）
   - 同时 `console.log` 一份，便于排查
4. 把 [`test-sentences.md`](test-sentences.md) 里 30 条句子一条条喂进去，用户逐条核对
5. 错的分三类处理：
   - **prompt 问题**（意图说明不清）→ 调 system prompt
   - **schema 问题**（skill 描述/examples 有误导）→ 改 JSON
   - **模型能力不够**（快模型搞不定）→ 换更强的模型或把 chat 分流到大模型（见 plan.md 开放风险）

**阶段 A 通过标准**：30 条全对，或者用户明确 OK 的容错（比如 27 对 3 错但那 3 条本来就是边界，能接受）。

### 阶段 B · Slot 填表检查

阶段 A 的 JSON 输出里已经包含 slots，所以**不是单独一阶段**——
阶段 A 每条核对时就同步看 slots 对不对。用户确认 slots 也 OK 即通过。

### 阶段 C · 放行执行（一次一个 skill）

**目标**：证明 skillExecutor 能正确 dispatch、handler 能正确执行。

**怎么做**：
1. dry-run 开关改成**按 skill id 开关**（或者按 category）
   - 例如默认全部 dry-run，放行清单 `ALLOW = ["music.play"]`
2. 只接入 `music.play` 一个 skill 到 executor；其它仍走 dry-run
3. 用户用真实命令触发：
   - `放首歌` → 应实际开始放歌
   - `播放夜曲` → 应播放夜曲
   - `暂停` → 应暂停
4. 每个 skill 通过后再把下一个（`vesync.on` 等）加入 ALLOW

**阶段 C 通过标准**：每个 skill 至少 3 条不同说法都能正确执行，且用户亲眼确认效果。

### 阶段 D · TTS 三档

**目标**：验证 silent / brief / full 反馈各自合理，打断机制稳。

**怎么做**：
1. 实现 `ttsManager.speakByPolicy(handlerResult)`
2. 对每个已放行的 skill 标上默认 tts_policy，用户测听感觉：
   - silent 档：开关灯→只听到 cue 提示音
   - brief 档：放歌→"已播放夜曲"
   - full 档：查天气→LLM 自然口播
3. 测打断：
   - 长 full 模式播报中喊"小智" → 立即停嘴
   - 故意构造含"小智"的播报文本 → 不自触发（替换或临时禁用 KWS）
   - 按键/点击悬浮球也能停

**阶段 D 通过标准**：三档听起来都合理，小智打断可靠，无自触发。

### 阶段 E · Workflow（**本次不做**）

留给下一版。框架：workflow = JSON 描述的多 skill 串联 + 可选条件分支。
本次做完 A–D 就收工。

## 阶段 A 的产物 / 交付物模板

跑 30 条测试句时，建议把结果记录成表格（可以直接存成一个 markdown 文件，commit 进仓库，
office 机器接着干）。格式：

```md
| # | 句子 | 预期 intent | 实际 intent | 预期 skill | 实际 skill | slots 对吗 | 备注 |
|---|---|---|---|---|---|---|---|
| 1 | 今天天气真好啊 | chat | chat | - | - | - | ✅ |
| 2 | ... | action | chat | music.play | - | - | ❌ 漏判，改 prompt |
```

错的行要写明**为什么错 + 怎么改**，下次跑前改完再跑。

## 操作约束（对实施者）

1. **先改 prompt / schema，后改代码结构**——绝大多数错能通过 prompt 微调解决
2. **一次只改一个变量**——改了 prompt 和换了模型同时生效，你分不清哪个起作用
3. **每阶段过闸后再 commit**——失败的尝试别污染 main 分支历史
4. **用户 ≠ 测试员**——你先自己跑一遍自检，明显错了自己改完再给用户；别把低级错误扔给用户
