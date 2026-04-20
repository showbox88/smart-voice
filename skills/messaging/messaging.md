---
name: messaging
category: messaging
description: >-
  Send a message via WeChat / email / SMS. Use for "给张三发微信说我迟到了",
  "帮我写邮件给老板", "发短信给妈妈说...". The handler is currently stubbed —
  until a messaging backend is wired, it acknowledges and reports "not
  configured". Keep routing here so the behavior stays consistent.
trigger_phrases:
  zh:
    - 发微信
    - 给XX发微信
    - 写邮件
    - 发邮件
    - 发短信
  en:
    - send a wechat
    - send an email
    - send an sms
    - text
parameters:
  - name: platform
    type: enum
    required: true
    values:
      - wechat
      - email
      - sms
    description: Which channel. "wechat" / "email" / "sms".
  - name: recipient
    type: string
    required: true
    description: >-
      Who to send to. Chinese name, English name, phone number, or email
      address — pass what the user said.
    examples:
      - 张三
      - 老板
      - mom@example.com
      - 13800000000
  - name: content
    type: string
    required: true
    description: The message body. If the user didn't specify, summarize their intent in one short sentence.
    examples:
      - 我今天迟到 10 分钟
      - 明天的会议推迟到 3 点
handler: messaging.send
response_mode: passthrough
---

# Messaging

消息发送（Stub）。

## 现状

没接任何消息通道，handler 每次返回「消息发送尚未配置」加用户原意图的回显。用途同 `aircon`：给 router 一个确定的 action 落点，用户得到一致反馈。

## 后续接入方式（任选）

- **邮件**：`nodemailer` + SMTP（最容易）
- **短信**：Twilio / 阿里云短信（需账号）
- **微信**：ItChat / WeChaty（需扫码；官方限制个人号自动发消息）

## 注意

隐私敏感，真接入时需要：
- 所有发送前要让用户最终确认
- 收件人模糊匹配要显式列候选
- 默认不保留 content 到本地 SQLite
