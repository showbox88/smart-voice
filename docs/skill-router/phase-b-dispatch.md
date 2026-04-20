# Phase B · 半开派发（Half-Open Dispatch）

状态：**代码已铺，默认关闭**。Phase A 路由（v7）仍是默认对话入口。

## 三档开关（localStorage）

| Key | 值 | 效果 |
|---|---|---|
| `skillRouterDryRun` | `"0"` | 关闭分类预览（默认 `"1"`，开着时只显示 JSON） |
| `skillRouterDispatch` | `"1"` | 打开半开派发 |

两个开关的组合：

1. `dryRun=1`（默认）→ 路由分类后只显示 JSON，不执行。Phase A 状态。
2. `dryRun=0` + `dispatch=1` → **半开派发**：
   - `action` → 直接调 skill handler，渲染 `responseMode`（passthrough/template/commentary）
   - `unclear` → 渲染一句 `ask`，结束
   - `chat` → 降级到原来的完整 LLM streaming（带 RAG + 工具调用）
3. `dryRun=0` + `dispatch=0` → 老的纯 LLM + tool-calling 路径（不经路由）

## 启用步骤

1. 开 DevTools（Ctrl+Shift+I）
2. 执行：
   ```js
   localStorage.setItem("skillRouterDryRun", "0");
   localStorage.setItem("skillRouterDispatch", "1");
   ```
3. 刷新或重启窗口
4. 说几句话，对比聊天气泡里新的 `⚡` 徽章（派发）vs `🧪` 徽章（dry-run）

## 观察指标

派发后的助手消息头格式：
```
⚡ **skill_name** · 🧠 1234ms + 🛠 45ms = 1279ms
```

- 🧠 = 路由分类延迟（本地 Qwen3-4B）
- 🛠 = skill handler 执行延迟
- 总延迟目标：≤ 2.0s p95（action 类命令）

## 回退

有问题立刻回到 dry-run：
```js
localStorage.setItem("skillRouterDryRun", "1");
localStorage.setItem("skillRouterDispatch", "0");
```

## 已知限制

- **commentary 模式短路**：当前把 `commentary` 当 `passthrough` 处理（只显示 `displayText`）。未来需要把 tool result 回喂给 LLM 做自然语言包装。
- **chat 分支两次请求**：当前如果 router 判 chat，会先发一次路由请求（~1.2s），再走完整 LLM streaming。这是主要的延迟 tax。后续可让路由的 `reply` 字段直接作为回复。
- **派发失败无 fallback**：skill 抛错时只渲染错误，不重试/不转 LLM。故意保守。
- **无会话上下文**：路由只看当前这一句。"它/那个"类指代依赖上下文的句子会走 unclear，和 dry-run 行为一致。

## 下一步

1. 你开关跑 10 句，人工核验（录一下哪些 action 派发正确 / 哪些翻车）
2. commentary 模式回喂 LLM（如果你用到的 skill 有 commentary 的）
3. chat 分支：把 router 的 `reply` 直接显示（省掉第二次 LLM 调用），仅在 `reply` 为空或用户句子复杂时回退到完整流
4. Phase B 新 skill：light_dim / aircon / reminder / messaging / query / app_launcher
