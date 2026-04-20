---
name: reminder
category: system
description: >-
  Create a local reminder that fires as a system notification at a specified
  time. Use when the user asks to be reminded of something ("提醒我下午 3 点开会",
  "设个 7 点的闹钟", "remind me in 10 minutes to ..."). The `when` field
  accepts relative ("10分钟后" / "30 minutes later") and absolute ("15:30" /
  "下午3点" / "明天早上8点") forms.
trigger_phrases:
  zh:
    - 提醒我
    - 设闹钟
    - 设个闹钟
    - 定时提醒
    - 记得提醒
  en:
    - remind me
    - set an alarm
    - set a reminder
parameters:
  - name: message
    type: string
    required: true
    description: What to remind the user about — the body of the notification.
    examples:
      - 开会
      - 给张三回电话
      - 吃药
  - name: when
    type: string
    required: true
    description: >-
      When to fire. Accepts relative (N秒后 / N分钟后 / N小时后 / N天后 / in N minutes)
      or absolute (HH:MM 24h / X点 / 下午X点 / 早上X点 / 明天Y点). If the user says a
      bare "X点" without period, assume the next occurrence.
    examples:
      - 10分钟后
      - 下午3点
      - 15:30
      - 明天早上8点
handler: system.createReminder
response_mode: passthrough
---

# Reminder

本地提醒。handler 通过 `reminder:create` IPC 把 `{message, fireAt}` 持久化到 SQLite，到点用 Electron `Notification` 弹出。

## 何时调用

用户说「提醒我…」「设个…的闹钟」「记得到…叫我…」这类调度语句。

## `when` 解析

`parseWhen()` 支持：
- 相对：`10分钟后`、`30秒后`、`2小时后`、`1天后`、`in 10 minutes`
- 绝对（24h）：`15:30`、`23:00`
- 中文时点：`下午3点`、`早上8点半`、`晚上9点15分`、`明天早上8点`

解析失败 → handler 返回提示让用户换说法，不硬猜。
