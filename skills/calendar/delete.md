---
name: calendar_cancel
category: calendar
description: >-
  Cancel/delete events on the user's primary Google Calendar. Use when the user
  says "取消", "删掉", "cancel", "remove" about an event or a whole day/week's
  schedule ("把明天的安排取消", "取消今天下午3点的会", "cancel tomorrow's
  meetings"). If several events match and the user didn't say "all", the skill
  will list them and ask the user to pick one — not delete blindly. Skill only
  registers when a Google account is connected.
trigger_phrases:
  zh:
    - 取消
    - 删掉
    - 删除
    - 把那个会议取消
    - 不要开会了
    - 把今天的会议取消
    - 把明天的安排取消
    - 取消日程
    - 删掉日历
  en:
    - cancel meeting
    - cancel event
    - delete event
    - remove from my calendar
    - cancel my schedule
    - cancel all meetings
parameters:
  - name: range
    type: enum
    required: false
    default: today
    values: [today, tomorrow, week, next]
    description: >-
      Which window to look in for the event(s) to cancel. "today" = 00:00 to
      23:59 today; "tomorrow" = same for tomorrow; "week" = next 7 days;
      "next" = the single next upcoming event within 3 days. Pick based on the
      user's phrasing ("今天" → today, "明天" → tomorrow, "本周/这周" → week).
      If the user only names the event title without a time ("把跟张三的会取消"),
      use "week" to widen the search.
    examples:
      - today
      - tomorrow
      - week
      - next
  - name: match
    type: string
    required: false
    description: >-
      Fuzzy match against the event title to pick a specific one. Use when the
      user names the event ("把跟AI的会议取消" → match:"AI",
      "cancel lunch with Kevin" → match:"Kevin" or match:"lunch"). Leave empty
      to target everything in the range.
    examples:
      - AI
      - 张三
      - Kevin
      - lunch
  - name: all
    type: boolean
    required: false
    default: false
    description: >-
      Set true only when the user explicitly says "all" / "全部" / "所有"
      ("把明天所有会议都取消" → true). Default false — the skill will list
      candidates and ask the user to pick when multiple match.
    examples:
      - true
handler: calendar.cancel
response_mode: passthrough
availability:
  requires: [google_calendar_connected]
---

# Calendar Cancel

删除/取消 Google 日历上的事件。handler 先在指定 range 里查事件,有 match 就再筛标题。

## 何时调用

用户明确要**取消 / 删除 / 移除**一个或多个日历事件。注意和 `calendar_query`(查询)/ `calendar_create`(新建)区分。

## 槽位选择

| 用户话 | `range` | `match` | `all` |
|---|---|---|---|
| 「把今天的会议取消」 | today | — | false |
| 「把明天的安排取消」 | tomorrow | — | false |
| 「把跟 AI 的会议取消」 | week | "AI" | false |
| 「把明天跟张三的会取消」 | tomorrow | "张三" | false |
| 「把本周所有会议都取消」 | week | — | true |
| 「cancel all my meetings tomorrow」 | tomorrow | — | true |

## 多选歧义

`all=false` 且 range 内匹配到多条时,handler 返回列表让用户二次确认,**不**盲删。用户再说「取消第 2 个」或「都取消」时,第二轮把 `all` 或具体匹配填上即可。

## 边界

- 「明天下午 3 点开个会」→ 不是这里,是 `calendar_create`
- 「明天有什么安排」→ 不是这里,是 `calendar_query`
- 「提醒我 3 点开会」→ `reminder`(本地提醒,不动日历)

## 重要:`when` 永远是 "now"

取消动作本身是立刻执行的,不是「明天执行删除」。所以 `when="now"`,日期信息放 `range` 里。router 的 `when` 字段只管**什么时候跑这个动作**,不管**取消哪天的事件**。
