---
name: windows_control
category: system
description: >-
  Windows 桌面兜底控制 (fallback)。当用户请求 UI 操作（点击、打字、截图、
  最小化/最大化、切换窗口、粘贴、滚动等）且 catalog 里没有更具体的 skill
  时调用。典型：「最小化当前窗口」、「截一张屏」、「在记事本里打 hello」、
  「关掉所有 Chrome 窗口」。具体的启动 app → app_launcher；智能家居 →
  smart_device / vesync_*；音乐 → play_music / music_control；日历 →
  calendar_*。这条只在上面都不对口时兜底。
trigger_phrases:
  zh:
    - 最小化
    - 最大化
    - 关掉窗口
    - 切换窗口
    - 截图
    - 截屏
    - 粘贴
    - 复制选中
    - 把光标
    - 右键
    - 滚动
  en:
    - minimize
    - maximize
    - close window
    - switch window
    - screenshot
    - paste
    - scroll
parameters:
  - name: intent
    type: string
    required: true
    description: >-
      Natural-language description of the desktop action. Pass the user's raw
      phrasing verbatim; do not summarize or translate. The main process
      picks the right MCP tool and executes it.
    examples:
      - 最小化当前窗口
      - 截一张屏
      - 在记事本里打 hello
      - 关掉所有 Chrome 窗口
handler: windowsControl.execute
response_mode: passthrough
availability:
  requires: [windows_mcp_available]
---

# Windows Control (fallback)

Windows-MCP 兜底。当用户的意图既不是启动 app、控制设备、放音乐、查日历、发消息，也不是查询/聊天，而是具体的**桌面 UI 操作**时才走这里。

## 何时调用

Router 先过 R1–R12 所有规则；任何一条命中具体 skill 都优先走那条。只有都不匹配且**确实是桌面操作**（点击/打字/窗口/截图/粘贴等）才落到这里。

## 边界

- 「打开记事本」→ `app_launcher`（不是这里）
- 「开客厅灯」→ `smart_device`（不是这里）
- 「今天有什么安排」→ `calendar_query`（不是这里）
- 「最小化当前窗口」→ **这里**
- 「截一张屏」→ **这里**
- 「把记事本里选中内容复制」→ **这里**

## 参数

`intent` 传用户原话，不要摘要。主进程的 windowsMcpManager 会让本地 LLM 从 Windows-MCP 的工具列表里挑一个执行。v1 只做单步；多步任务（「打开记事本然后打字 hello」）v1 可能失败，是预期行为。
