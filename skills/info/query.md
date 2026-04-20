---
name: info_query
category: info
description: >-
  Deterministic clock/calendar lookup: current time, today's date, today's
  weekday. Handled locally without a LLM streaming call. ONLY use for literal
  "现在几点" / "今天几号" / "今天星期几". NEVER use for 天气 / 股价 / 新闻 /
  相对日期（下周一是几号）— those are chat so the main LLM can answer with full
  context (web search or "not wired yet").
trigger_phrases:
  zh:
    - 现在几点
    - 今天几号
    - 今天星期几
  en:
    - what time
    - what date
    - what day
parameters:
  - name: type
    type: enum
    required: true
    values:
      - time
      - date
      - weekday
    description: >-
      What kind of info. "time" = current clock (HH:MM). "date" = today's
      calendar date. "weekday" = day of week. Weather / stock / news are OUT
      of scope — route those to chat.
handler: info.query
response_mode: passthrough
---

# Info Query

给 router 一条快速通道回答"现在几点""今天星期几"这类确定性问题，省下一次完整的 LLM streaming。

## 边界

- `time` / `date` / `weekday` —— 直接渲染本地时间，回复长度 1 行
- `weather` / `stock` / `news` —— 返回"未接入外部数据源"的提示。长期来看这些可以接 open-meteo / Alpha Vantage；现在先让 router 有路可走，handler 给出一致的降级回复

不要把"世界史""人是什么""给我推荐一本书"这类开放问题塞进来，那是 chat。
