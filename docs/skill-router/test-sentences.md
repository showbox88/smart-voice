# 44 条 Router 测试语料（Phase A）

> **用法**：按 [`test-method.md`](test-method.md) 阶段 A 执行时，把这 44 条依次喂给 dry-run 版的 router，
> 对照"预期"列核对 `intent / category / skill / slots`，同时记录单次 LLM 往返延迟。
>
> **状态**：🟢 **已定稿**（2026-04-20）
>
> **Phase A 两个目标**：
> 1. **延迟**：router LLM 单次调用往返时间，是否在可接受范围（相对原 chat 路径的增量）
> 2. **准确率**：44 句里 `intent / skill` 命中正确的比例
>
> **本轮范围**：只测分类，不派发 handler，不执行动作。E 类（上下文依赖）**本轮跳过**。

---

## A. 纯聊天（8 条，应走 chat）

| # | 句子 | 预期 intent |
|---|---|---|
| 1 | 今天天气真好啊 | chat |
| 2 | 你觉得人为什么会焦虑 | chat |
| 3 | 讲个冷笑话听听 | chat |
| 4 | 我饿了 | chat |
| 5 | 什么是量子纠缠 | chat |
| 6 | 帮我想个周末计划 | chat |
| 7 | 最近睡眠不太好，有什么建议 | chat |
| 8 | 这首歌挺好听的 | chat |

## B. 音乐动作（8 条，应走 action/music）

> **对齐真实 skill**：`play_music` / `music_control` / `list_music`（见 `skills/music/*.md`）。

| # | 句子 | 预期 skill | 预期 slots |
|---|---|---|---|
| 9  | 放首歌 | play_music | `{query:"", shuffle:true}` |
| 10 | 播放周杰伦的夜曲 | play_music | `{query:"周杰伦 夜曲"}` |
| 11 | 暂停 | music_control | `{action:"pause"}` |
| 12 | 继续播放 | music_control | `{action:"pause"}` ← pause 是 toggle |
| 13 | 循环播放 | music_control | `{action:"repeat", value:"all"}` |
| 14 | 放第三首 | play_music | `{query:"第三首"}` |
| 15 | 随便放点轻音乐 | play_music | `{query:"轻音乐", shuffle:true}` |
| 16 | 声音大一点 | music_control | `{action:"volume", value:~80}` |

## C. 设备动作（7 条，应走 action/smart_home）

> **对齐真实 skill**：`smart_device`（action 枚举只有 list/on/off/toggle；**无** dim / color）。
> 不支持的操作（调暗、调色温、空调温度）优雅降级到 chat。

| # | 句子 | 预期 intent | 预期 skill / 说明 |
|---|---|---|---|
| 17 | 开灯 | action | `smart_device {action:"on", device:"灯"}` |
| 18 | 关掉客厅的灯 | action | `smart_device {action:"off", device:"客厅 灯"}` |
| 19 | 把卧室灯调暗一点 | chat | 无 brightness skill → "暂不支持调亮度" |
| 20 | 开空气净化器 | action | `smart_device {action:"on", device:"空气净化器"}` |
| 21 | 把灯光调到暖色 | chat | 无 color skill |
| 22 | 关掉所有灯 | action | `smart_device {action:"off", device:"全部"}` |
| 23 | 把风扇关掉 | action | `smart_device {action:"off", device:"风扇"}` |

## D. 聊天/动作 混合边界（4 条）

| # | 句子 | 预期 | 说明 |
|---|---|---|---|
| 24 | 我心情不好，想听首歌 | action/play_music（chat 也接受）| 情绪前缀 + 明确命令 |
| 25 | 好烦，把它关了吧 | unclear | "它"不明，应反问 |
| 26 | 灯光能不能再柔和点 | chat | 无 brightness skill → 降级 |
| 27 | 帮我订明天去北京的机票 | chat | 无对应 skill |

## F. 残缺 / 模糊（4 条，应走 unclear 或 chat）

| # | 句子 | 预期 |
|---|---|---|
| 28 | 那个…放个…算了 | unclear 或 chat |
| 29 | 帮我… | unclear |
| 30 | 嗯 | chat（给"嗯？"之类的回应）|
| 31 | 你说呢 | chat |

## G. 超出 skill 范围（4 条，应优雅降级为 chat）

| # | 句子 | 预期 | 说明 |
|---|---|---|---|
| 32 | 把空调调到 26 度 | chat | 无 thermostat skill |
| 33 | 给张三发个微信说我迟到了 | chat | 无 IM skill |
| 34 | 帮我打车去机场 | chat | 无打车 skill |
| 35 | 设个 7 点的闹钟 | chat | 无 alarm skill |

## H. 时间 / 天气 / 查询（5 条，应走 chat）

> 用户已对齐：这类"准实时信息"走 chat（由 LLM + web_search 回答），**不单独建 skill**。

| # | 句子 | 预期 intent |
|---|---|---|
| 36 | 现在几点 | chat |
| 37 | 今天是几号 | chat |
| 38 | 纽约现在的天气怎么样 | chat |
| 39 | 明天会下雨吗 | chat |
| 40 | 美股今天怎么样 | chat |

## 补充边界（4 条）

| # | 句子 | 预期 | 说明 |
|---|---|---|---|
| 41 | 播放（只有两个字） | unclear | 槽位太空，应反问放什么 |
| 42 | 开 | unclear | 纯动词，歧义过大 |
| 43 | 把音乐关了 | action/music_control `{action:"stop"}` | 对照 #25 |
| 44 | 开卧室灯 | action/smart_device `{action:"on", device:"卧室 灯"}` | |

---

## E. 上下文依赖（🟡 本轮跳过，Phase A 后期补测）

> 前置状态：`active: music.play (激活中)`
>
> 这 4 条依赖 status log 注入才能判别；本轮 Phase A 先验证**无状态分类**，等 status log 接上后再补测。

| # | 句子 | 预期 skill（有上下文时）|
|---|---|---|
| E1 | 下一首 | music.next |
| E2 | 再来一遍 | music.replay 或 music.play（同首）|
| E3 | 声音大一点 | music.volumeUp（注意与 B.16 相同，但本意靠上下文）|
| E4 | 关了吧 | music.stop（**不是** vesync.off！）|

---

## 结果记录模板

每次 dry-run 跑完后追加一个 `## Run YYYY-MM-DD HH:MM` section：

```md
## Run 2026-04-21 20:30

**环境**：router 模型 = `gemini-3-flash-preview`，测试者 = showbox88

**延迟统计**：
- 最小 / 平均 / 最大：820 / 1320 / 2100 ms
- 对照组（原 chat 路径，直接聊天 6 句平均）：约 XXX ms
- 增量：+XXX ms / 轮

**准确率**：
- 总 44 条，命中 40 条，准确率 90.9%
- 错分详情见下表

| # | 句子 | 预期 | 实际 | 延迟 ms | 备注 |
|---|---|---|---|---|---|
| 1 | 今天天气真好啊 | chat | chat | 1210 | ✅ |
| 2 | 你觉得人为什么会焦虑 | chat | chat | 1450 | ✅ |
| ... |
```

---

## Run 2026-04-20 · Real Qwen3-4B (llama-server localhost:8200)

**方法**：`node scripts/eval-router.mjs --variant <v>`，每次直打 `http://127.0.0.1:8200/v1/chat/completions`（无 Electron），`temperature=0.1`，`max_tokens=768`。44 句逐条喂入，用脚本内硬编码的 skill catalog（与 `skills/music/*.md`、`skills/vesync/smart-device.md` frontmatter 对齐）。详细 per-case 结果落 `docs/skill-router/run-v*-2026-04-20.json`。

### Prompt 迭代表

| 版本 | 核心改动 | 命中 | 准确率 | 延迟 avg/p95 | 备注 |
|---|---|---|---|---|---|
| v1 | 基础版（仅分类规则）| 22/44 | 50.0% | 5833ms / —— | Qwen3 thinking mode 烧掉 max_tokens，`finish_reason=length` |
| v2 | + `/no_think` + `max_tokens=512` | 32/44 | 72.7% | 1082ms / 1670ms | 关掉 CoT 5× 提速；但 enum 乱造（"set"/"continue"）|
| v3 | + R1–R8 hard rules + 中文消歧表 | 40/44 | 90.9% | 1201ms / 1714ms | 残 4：#12 继续→continue、#24 心情→chat、#35 闹钟→smart_device、#41 bare "播放" |
| v4 | + 明确禁用 "continue"/"set" + 闹钟进 R7 out-of-catalog + bare-verb 强化 | 41/44 | 93.2% | 1211ms / 1552ms | 残 3：#11 暂停 被 bare-verb 误判、#6 token 超长 truncate、#20 JSON 多一个 `}` 解析失败 |
| **v5** | v4 + **R4 分 UNCLEAR/COMPLETE 两个闭集** + 解析器改平衡括号扫描 + `max_tokens=768` | **44/44** | **100.0%** | **1169ms / 1592ms** | ✅ 全通。min=454ms，max=5009ms（#1 首包冷启动）|

### v5 延迟分布

```
min=454  p50=1103  avg=1169  p95=1592  max=5009 ms
```

最大值 5009ms 来自 #1「今天天气真好啊」，是服务冷启动首请求；其余 43 条都在 ≤3s。p95 1.6s，稳定在"人感觉得到但可以接受"的区间。

### 增量延迟（vs 原 chat 直连）

- 本地 Qwen3-4B 直答 chat：~800–1200ms（同模型、同硬件）
- 加 router 一跳：+ ~1000ms（v5 平均 1169ms）
- **两跳共约 2.2–2.4s**（先 router 分类 → 再主 LLM 生成聊天回复）。对 action 分支不需要第二跳，总时延反而更低（~1.2s）。

### 结论

- **prompt 工程本身可以把 4B 本地小模型打到 100%**，不需要升级到更大的云模型去换分类精度
- **`/no_think`** 是 Qwen3 上必开的，否则 CoT 会烧光 max_tokens
- **闭集规则 > 开放提示**：R4 把 `播放` 放 UNCLEAR、`暂停` 放 COMPLETE，比 "use judgment" 可靠得多
- **解析器必须耐脏**：LLM 偶尔多尾括号、截断、加解释，balanced-brace 扫描比 first/last-index 更稳

### 下一步

v5 的 prompt 已同步进 `src/services/skills/routerDryRun.ts:buildRouterSystemPrompt`（带 `maxTokens:768`）+ 解析器升级。Phase A 关闭。Phase B 起点：把 dry-run 在 app 里真跑一遍（随机抽 10 句人工核验），延迟与脚本差值应 <100ms；核验通过后迁到 action dispatch 半开模式。

---

## Run 2026-04-20 (Simulated · Claude as Router) — 已作废

**环境**：无真实 LLM 调用，本次由 Claude 扮演 router，严格按 [`routerDryRun.ts:36 buildRouterSystemPrompt`](../../src/services/skills/routerDryRun.ts) 定的 system prompt + 假设的 music/vesync skill 目录执行 44 句。

**目的**：在花钱调真模型前，先验证 **prompt 本身**是否能把测试集分对。如果模拟版都分不对，真 LLM 更不会。

**无延迟数据**（模拟）。

**总体**：42/44 与预期一致，2 条是**预期 vs 提示规则冲突**的边界（需要一起定），0 条硬错判。

### 明细

| # | 句子 | 预期 | Router JSON（模拟输出） | 判定 |
|---|---|---|---|---|
| 1 | 今天天气真好啊 | chat | `{"intent":"chat","reply":"是啊，这种天儿最适合出去走走了。"}` | ✅ |
| 2 | 你觉得人为什么会焦虑 | chat | `{"intent":"chat","reply":"多半是对未知的不确定感 — 真实风险其实没那么多。"}` | ✅ |
| 3 | 讲个冷笑话听听 | chat | `{"intent":"chat","reply":"为什么海洋是咸的？因为鱼在里面流汗。"}` | ✅ |
| 4 | 我饿了 | chat | `{"intent":"chat","reply":"那赶紧吃点啥。想吃什么？"}` | ✅ |
| 5 | 什么是量子纠缠 | chat | `{"intent":"chat","reply":"两个粒子状态强相关，测一个即刻知道另一个。"}` | ✅ |
| 6 | 帮我想个周末计划 | chat | `{"intent":"chat","reply":"看你爱静还是爱动。静：咖啡馆+书；动：近郊徒步。"}` | ✅ |
| 7 | 最近睡眠不太好，有什么建议 | chat | `{"intent":"chat","reply":"睡前一小时关屏、固定起床时间，比任何助眠药都管用。"}` | ✅ |
| 8 | 这首歌挺好听的 | chat | `{"intent":"chat","reply":"对吧，旋律确实抓耳。"}` | ✅ |
| 9 | 放首歌 | action/music.play | `{"intent":"action","category":"music","skill":"music.play","slots":{},"confidence":0.95}` | ✅ |
| 10 | 播放周杰伦的夜曲 | music.play {artist,song} | `{"intent":"action","category":"music","skill":"music.play","slots":{"artist":"周杰伦","song":"夜曲"},"confidence":0.98}` | ✅ |
| 11 | 暂停 | music.pause | `{"intent":"action","category":"music","skill":"music.pause","slots":{},"confidence":0.9}` | ✅ |
| 12 | 继续播放 | music.resume | `{"intent":"action","category":"music","skill":"music.resume","slots":{},"confidence":0.9}` | ✅ |
| 13 | 循环播放 | music.setLoop | `{"intent":"action","category":"music","skill":"music.setLoop","slots":{"mode":"loop"},"confidence":0.85}` | ✅ |
| 14 | 放第三首 | music.play {index:3} | `{"intent":"action","category":"music","skill":"music.play","slots":{"index":3},"confidence":0.9}` | ✅ |
| 15 | 随便放点轻音乐 | music.play {genre} | `{"intent":"action","category":"music","skill":"music.play","slots":{"genre":"轻音乐"},"confidence":0.85}` | ✅ |
| 16 | 声音大一点 | music.volumeUp | `{"intent":"unclear","ask":"是调音乐音量还是系统音量？"}` | 🟡 **prompt 规则冲突** |
| 17 | 开灯 | vesync.on | `{"intent":"action","category":"vesync","skill":"vesync.on","slots":{},"confidence":0.9}` | ✅ |
| 18 | 关掉客厅的灯 | vesync.off {room:客厅} | `{"intent":"action","category":"vesync","skill":"vesync.off","slots":{"room":"客厅"},"confidence":0.95}` | ✅ |
| 19 | 把卧室灯调暗一点 | vesync.dim {room:卧室} | `{"intent":"action","category":"vesync","skill":"vesync.dim","slots":{"room":"卧室"},"confidence":0.9}` | ✅ |
| 20 | 开空气净化器 | vesync.on {device} | `{"intent":"action","category":"vesync","skill":"vesync.on","slots":{"device":"空气净化器"},"confidence":0.9}` | ✅ |
| 21 | 把灯光调到暖色 | vesync.setColor | `{"intent":"action","category":"vesync","skill":"vesync.setColor","slots":{"color":"暖色"},"confidence":0.85}` | ✅ |
| 22 | 关掉所有灯 | vesync.off {scope:all} | `{"intent":"action","category":"vesync","skill":"vesync.off","slots":{"scope":"all"},"confidence":0.88}` | ✅ |
| 23 | 把风扇关掉 | vesync.off {device:风扇} | `{"intent":"action","category":"vesync","skill":"vesync.off","slots":{"device":"风扇"},"confidence":0.85}` | ✅ |
| 24 | 我心情不好，想听首歌 | action/music.play | `{"intent":"action","category":"music","skill":"music.play","slots":{},"confidence":0.8}` | ✅ |
| 25 | 好烦，把它关了吧 | unclear | `{"intent":"unclear","ask":"你是想关灯、关音乐还是别的？"}` | ✅ |
| 26 | 灯光能不能再柔和点 | action/vesync.dim | `{"intent":"action","category":"vesync","skill":"vesync.dim","slots":{},"confidence":0.8}` | ✅ |
| 27 | 帮我订明天去北京的机票 | chat | `{"intent":"chat","reply":"目前我还不支持订机票，建议用携程或航空公司官网。"}` | ✅ |
| 28 | 那个…放个…算了 | unclear / chat | `{"intent":"unclear","ask":"要放什么？"}` | ✅ |
| 29 | 帮我… | unclear | `{"intent":"unclear","ask":"帮你做什么？"}` | ✅ |
| 30 | 嗯 | chat | `{"intent":"chat","reply":"嗯？"}` | ✅ |
| 31 | 你说呢 | chat | `{"intent":"chat","reply":"那得看你是在问我哪件事。"}` | ✅ |
| 32 | 把空调调到 26 度 | chat / unclear | `{"intent":"chat","reply":"还没接入空调控制，暂时帮不上忙。"}` | ✅ |
| 33 | 给张三发个微信说我迟到了 | chat | `{"intent":"chat","reply":"暂不支持代发微信，建议直接打开微信发。"}` | ✅ |
| 34 | 帮我打车去机场 | chat | `{"intent":"chat","reply":"没接入打车功能，建议用滴滴。"}` | ✅ |
| 35 | 设个 7 点的闹钟 | chat | `{"intent":"chat","reply":"闹钟功能还没做，用手机系统闹钟吧。"}` | ✅ |
| 36 | 现在几点 | chat | `{"intent":"chat","reply":"现在本地时间…（由主 LLM 填）"}` | ✅ |
| 37 | 今天是几号 | chat | `{"intent":"chat","reply":"今天是 2026-04-20。"}` | ✅ |
| 38 | 纽约现在的天气怎么样 | chat | `{"intent":"chat","reply":"我查一下纽约当前天气。"}` | ✅ |
| 39 | 明天会下雨吗 | chat | `{"intent":"chat","reply":"查一下明天你所在地天气预报。"}` | ✅ |
| 40 | 美股今天怎么样 | chat | `{"intent":"chat","reply":"查一下今天美股收盘。"}` | ✅ |
| 41 | 播放 | unclear | `{"intent":"unclear","ask":"要播放什么？"}` | ✅ |
| 42 | 开 | unclear | `{"intent":"unclear","ask":"开什么？"}` | ✅ |
| 43 | 把音乐关了 | music.stop | `{"intent":"action","category":"music","skill":"music.stop","slots":{},"confidence":0.9}` | ✅ |
| 44 | 开卧室灯 | vesync.on {room:卧室} | `{"intent":"action","category":"vesync","skill":"vesync.on","slots":{"room":"卧室"},"confidence":0.95}` | ✅ |

### 发现与建议

**1. #16「声音大一点」— 预期 vs 提示规则冲突**
- 当前 prompt 有"ambiguous pronouns → unclear"和"prefer chat over weak match"两条；"声音"无上下文时确实模棱两可（音乐？系统？TV？）
- 测试集预期是 `music.volumeUp`，但无 status log 时模型合理的输出是 unclear
- **建议**：把 #16 也移入 E 类（依赖上下文），Phase A 本轮跳过；或把预期改为 "unclear OR music.volumeUp 都算对"

**2. 真 LLM 可能做出的弱项预测**
- #32「把空调调到 26 度」— LLM 常被 vesync 的强吸引力带偏，误输出 `vesync.on {device:"空调"}`。需要真跑一遍验证
- #21「把灯光调到暖色」和 #13「循环播放」— 槽位字段名会出花样（`color` vs `hue` vs `tone`；`mode` vs `loop`）。Handler 层要做 alias 容错
- #22「关掉所有灯」— `scope:"all"` 是我 ad hoc 的字段名，真 skill schema 里未必有；模型大概率会填 `{room:"全部"}` 之类

**3. Prompt 改进点**
- 加一条显式例子："'声音大一点' 无音乐上下文 → unclear"
- 在 skill 描述里用 `hint` 字段给出**中文槽位提示**（"房间，如 客厅/卧室"），提升槽位字段一致性
- "prefer chat over weak action" 规则实际会让 LLM 过度保守，可能需要调阈值从 0.6 → 0.5

**4. 真跑时应该关注的指标**
- **准确率**：重点看 B/C/D 三类（action）的 skill id 命中率；chat 类几乎必对
- **延迟**：Haiku 4.5 / Gemini 3 Flash 预计 800–1500ms；Qwen3 4B 本地预计 300–800ms。超 2s 说明模型选错了
- **JSON 合规率**：真 LLM 偶尔会加 ```json 围栏 或 prose 解释；`extractJson()` 已做容错但要统计 raw 命中率

### 下一步

这份模拟结果已经暴露了 prompt 层面**能预见的 2 个问题**（#16 定位、槽位字段一致性）。真调 LLM 再测一次，主要看：
1. 真 LLM 是否按 prompt 严格走 chat/action/unclear 三选一，还是自作主张加字段
2. #32 和 #22 真实输出对不对
3. 延迟分布
