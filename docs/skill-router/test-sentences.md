# 30 条 Router 测试语料

> **用法**：按 [`test-method.md`](test-method.md) 阶段 A 执行时，把这 30 条依次喂给 dry-run 版的 router，
> 对照"预期"列核对 `intent / category / skill / slots`。
>
> **状态**：🟡 **草稿待用户定稿** — 句子和预期都可改。定稿后请把本标记改为 🟢 **已定稿**。

## A. 明确聊天（应走 chat，6 条）

| # | 句子 | 预期 intent | 备注 |
|---|---|---|---|
| 1 | 今天天气真好啊 | chat | |
| 2 | 你觉得人为什么会焦虑 | chat | |
| 3 | 讲个冷笑话听听 | chat | |
| 4 | 我饿了 | chat | 不是行动命令 |
| 5 | 什么是量子纠缠 | chat | |
| 6 | 帮我想个周末计划 | chat | "帮我" 非指令触发词 |

## B. 明确音乐动作（应走 action/music，5 条）

| # | 句子 | 预期 skill | 预期 slots |
|---|---|---|---|
| 7 | 放首歌 | music.play | `{}`（空槽走随机）|
| 8 | 播放周杰伦的夜曲 | music.play | `{artist:"周杰伦", song:"夜曲"}` |
| 9 | 暂停 | music.pause | `{}` |
| 10 | 循环播放 | music.setLoop | `{mode:"loop"}` 或 `{}` |
| 11 | 放第三首 | music.play | `{index:3}` |

## C. 明确设备动作（应走 action/vesync，5 条）

| # | 句子 | 预期 skill | 预期 slots |
|---|---|---|---|
| 12 | 开灯 | vesync.on | `{}` |
| 13 | 关掉客厅的灯 | vesync.off | `{room:"客厅"}` |
| 14 | 把卧室灯调暗一点 | vesync.dim | `{room:"卧室"}` |
| 15 | 开空气净化器 | vesync.on | `{device:"空气净化器"}` |
| 16 | 把灯光调到暖色 | vesync.setColor | `{color:"暖色"}` |

> 注：实际 vesync skill 的 slot 字段名以 `src/services/skills/handlers/vesync.ts` 为准，
> 这里的字段名是草稿；定稿时对齐真实 schema。

## D. 聊天/动作混合 边界（4 条）

| # | 句子 | 预期 | 说明 |
|---|---|---|---|
| 17 | 我心情不好，想听首歌 | action/music.play | 混合，动作成分应占优 |
| 18 | 好烦，把它关了吧 | unclear | "它"不明，应反问 |
| 19 | 这首歌挺好听的 | chat | 评论，不是指令 |
| 20 | 灯光能不能再柔和点 | action/vesync.dim | 疑问句型但是指令意图 |

## E. 上下文依赖（验 status log，4 条）

**前置状态**：`active: music.play (激活中)`

| # | 句子 | 预期 skill（有上下文时）|
|---|---|---|
| 21 | 下一首 | music.next |
| 22 | 再来一遍 | music.replay 或 music.play（同首）|
| 23 | 声音大一点 | music.volumeUp |
| 24 | 关了吧 | music.stop（**不是** vesync.off！）|

> 阶段 A 可暂不测这 4 条；等 status log 接上之后补测。

## F. 残缺 / 模糊（应走 unclear，3 条）

| # | 句子 | 预期 |
|---|---|---|
| 25 | 那个…放个…算了 | unclear 或 chat |
| 26 | 帮我… | unclear |
| 27 | 嗯 | chat（给"嗯？"之类的回应）|

## G. 超出已有 skill 范围（应优雅降级，3 条）

| # | 句子 | 预期 | 说明 |
|---|---|---|---|
| 28 | 帮我订明天去北京的机票 | chat | 无 skill，应 LLM 回 "目前不支持订票" |
| 29 | 把空调调到 26 度 | chat / unclear | 无 aircon skill；若 vesync 覆盖则 action |
| 30 | 给张三发个微信说我迟到了 | chat | 无 IM skill |

---

## 结果记录模板

跑完后建议追加一个结果 section 在本文件尾部，或者新起一个 `test-run-YYYY-MM-DD.md`：

```md
## Run 2026-04-21

| # | 实际 intent | 实际 skill | slots | 是否通过 | 备注 |
|---|---|---|---|---|---|
| 1 | chat | - | - | ✅ | |
| 2 | chat | - | - | ❌ | router 漏判为 action，改 prompt |
| ... |
```
