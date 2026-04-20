---
name: aircon
category: climate
description: >-
  Control the air conditioner: on/off, set target temperature, or switch mode
  (cool/heat/fan/auto/dry). Use for "把空调调到 26 度", "开空调", "关空调",
  "空调切到制热". The handler is currently stubbed — until an IR blaster or
  vendor API is configured, it acknowledges the command and tells the user
  it's not wired yet. Keep routing here so the behavior stays consistent.
trigger_phrases:
  zh:
    - 开空调
    - 关空调
    - 空调调到
    - 空调切到
    - 温度调到
  en:
    - turn on the aircon
    - turn off the aircon
    - set aircon
    - air conditioner
parameters:
  - name: action
    type: enum
    required: true
    values:
      - "on"
      - "off"
      - set_temp
      - mode
    description: >-
      "on" / "off" = power. "set_temp" with numeric `value` = target °C.
      "mode" with string `value` (cool/heat/fan/auto/dry) = switch mode.
  - name: value
    type: any
    required: false
    description: >-
      For set_temp: integer 16-30. For mode: one of cool / heat / fan / auto / dry.
      Omit for on / off.
    examples:
      - 26
      - cool
      - heat
handler: climate.aircon
response_mode: passthrough
---

# Aircon

空调控制（Stub）。

## 现状

没接 IR 发射器、没接美的/格力/海尔等品牌 API，handler 每次返回「空调控制尚未配置」加用户原意图的回显。用途：

1. Router 有明确的 action 落点，不再把空调指令误判成 chat/smart_device
2. 用户得到一致的降级反馈
3. 一旦接入 IR/API，只改 handler，不动 prompt / skill 文件

## 后续接入方式（任选其一）

- **Broadlink RM 系列**：通过 `broadlinkjs-rm` 发红外
- **美的**：`midea-discover` + cloud API（需账号）
- **HomeAssistant**：已有桥接最省事

## 参数覆盖

| 用户说 | action | value |
|---|---|---|
| 开空调 | on | — |
| 关空调 | off | — |
| 空调调到 26 度 | set_temp | 26 |
| 空调切到制热 | mode | heat |
| 空调切到送风 | mode | fan |
