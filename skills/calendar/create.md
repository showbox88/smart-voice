---
name: calendar_create
category: calendar
description: >-
  Create a new event on the user's primary Google Calendar. Use when the user
  says "安排", "约", "schedule", "book" a specific event at a specific time
  ("明天下午3点和张三开会", "周三上午10点约牙医", "schedule lunch with Kevin
  Friday 12pm"). Not for reminders — those go to the `reminder` skill. Skill
  only registers when a Google account is connected.
trigger_phrases:
  zh:
    - 安排
    - 约
    - 预约
    - 加到日历
    - 加入日历
    - 添加日程
    - 新建日程
  en:
    - schedule
    - book
    - add to calendar
    - add to my calendar
    - put on my calendar
parameters:
  - name: summary
    type: string
    required: true
    description: >-
      Event title. Extract the subject of the meeting/event from the user's
      phrasing. Do NOT include time/date words — those go in `when`.
    examples:
      - 和张三开会
      - 牙医预约
      - lunch with Kevin
      - 团队周会
  - name: when
    type: string
    required: true
    description: >-
      Start time. Accepts relative ("10分钟后"/"in 30 minutes") or absolute
      ("15:30"/"下午3点"/"明天早上8点"). If the user says a bare "X点" without
      period word, assume the next occurrence.
    examples:
      - 明天下午3点
      - 15:30
      - 周三上午10点
      - 明天早上8点
  - name: duration_min
    type: number
    required: false
    default: 60
    description: >-
      Event duration in minutes. Default 60. Only set explicitly if the user
      says how long ("开半小时" → 30, "两小时的会议" → 120).
    examples:
      - 30
      - 60
      - 120
handler: calendar.create
response_mode: passthrough
availability:
  requires: [google_calendar_connected]
---

# Calendar Create

在用户的 Google 日历（primary）上创建事件。handler 通过主进程走 Google Calendar API POST。时间用 `parseWhenFast`，失败就让用户换说法不硬猜。

## 何时调用

用户明确要**安排/约/加到日历**一个**特定时间**的事件。

## 默认时长

用户不说时长就 1 小时。这对大部分「开会/约饭/见医生」语境够用。

## 边界

- 「提醒我 3 点开会」→ 不是这里，走 `reminder`（本地通知，不写进日历）
- 「今天有什么安排」→ 不是这里，走 `calendar_query`（查询）
- 「帮我发邮件约张三」→ 不是这里，走 `messaging`（发消息）
