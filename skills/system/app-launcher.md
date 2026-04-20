---
name: app_launcher
category: system
description: >-
  Launch a desktop application by name. Use when the user asks to open an app
  (e.g. "打开网易云音乐", "开 QQ 音乐", "start Chrome"). Fuzzy-matches the app
  name against installed applications. Pass the app name as the user said it —
  the main process resolves it to a binary or shortcut.
trigger_phrases:
  zh:
    - 打开
    - 启动
    - 开
    - 运行
  en:
    - open
    - launch
    - start
    - run
parameters:
  - name: app_name
    type: string
    required: true
    description: >-
      App name as the user said it. Examples: "网易云音乐", "QQ 音乐", "Chrome",
      "微信", "VS Code". Do NOT include quotes. Do NOT translate — pass the
      user's exact phrasing. Resolution happens in the main process.
    examples:
      - 网易云音乐
      - QQ 音乐
      - Chrome
      - 微信
handler: system.launchApp
response_mode: passthrough
---

# App Launcher

启动桌面应用。handler 通过主进程 `shell.openPath` / `spawn("start")` 打开。

## 何时调用

用户说「打开 XX」「开 XX」「启动 XX」，其中 XX 是一个应用名称而不是灯、音乐之类的设备/内容。

## 边界

- 「打开灯」→ 不是这里，走 `smart_device`（灯不是 app）
- 「打开音乐」→ 不是这里，走 `play_music`
- 「打开网易云音乐 app」「开 Chrome」→ 是这里
