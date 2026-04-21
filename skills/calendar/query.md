---
name: calendar_query
category: calendar
description: >-
  Query the user's Google Calendar for upcoming events. Use when the user asks
  about their schedule ("今天有什么安排？", "下一个会议是什么？", "这周忙吗？",
  "what's on my calendar tomorrow"). Returns events in a human-readable list.
  Skill only registers when a Google account is connected.
trigger_phrases:
  zh:
    - 今天有什么安排
    - 今天的日程
    - 明天有什么
    - 下一个会议
    - 下一个安排
    - 下一场会议
    - 这周忙吗
    - 本周安排
    - 我的日程
  en:
    - what's on my calendar
    - today's schedule
    - my schedule
    - next meeting
    - next event
    - what's next
parameters:
  - name: range
    type: enum
    required: false
    default: today
    values: [today, tomorrow, week, next]
    description: >-
      Which window to query. "today" = 00:00 to 23:59 today; "tomorrow" = same
      for tomorrow; "week" = next 7 days; "next" = the single next upcoming
      event within 3 days. Pick the one that matches the user's phrasing.
    examples:
      - today
      - tomorrow
      - week
      - next
handler: calendar.query
response_mode: commentary
availability:
  requires: [google_calendar_connected]
---

# Calendar Query

查询 Google 日历。handler 从本地 SQLite 读同步过来的事件（2 分钟同步一次），命中窗口的事件格式化后回给 LLM 让它继续对话。

## 何时调用

用户问自己的日程安排，不是问别人的，也不是创建新日程。

## range 映射

- 「今天」「今日」/ today → `today`
- 「明天」「明日」/ tomorrow → `tomorrow`
- 「这周」「本周」/ this week → `week`
- 「下一个会议」「接下来」/ next → `next`（只返回第一个）

## 边界

- 「明天下午 3 点安排开会」→ 不是这里，是 `calendar_create`（创建而不是查询）
- 「现在几点」→ 走 `info_query`（时钟）
- 「提醒我 3 点开会」→ 走 `reminder`（本地提醒，不是日历事件）
