---
name: light_dim
category: smart_home
description: >-
  Set the brightness of a smart bulb on VeSync. Use when the user asks to dim
  or brighten a light ("把卧室灯调暗一点", "灯调亮", "灯调到 50%"). NOT for on/off
  — those go to smart_device. `level` is 0-100 (0 = darkest, 100 = full). When
  the user says "调暗" without a number, infer ~30; "调亮" without a number, ~80.
trigger_phrases:
  zh:
    - 调暗
    - 调亮
    - 调节亮度
    - 灯调到
    - 柔和一点
  en:
    - dim the light
    - brighten the light
    - set brightness
parameters:
  - name: device
    type: string
    required: true
    description: >-
      Device name or class. Same fuzzy matching as smart_device. Examples:
      "卧室灯", "书房灯", "灯" (all lights).
    examples:
      - 卧室灯
      - 书房灯
      - 灯
  - name: level
    type: integer
    required: true
    description: >-
      Brightness 0-100. User says "调暗" → 30. "调亮" → 80. "柔和点" → 40.
      "再暗一点" → 20. Use a reasonable integer; the router handles the
      catalog-gate check.
    examples:
      - 30
      - 50
      - 80
handler: vesync.dim
response_mode: passthrough
availability:
  requires:
    - vesync_logged_in
---

# Light Dim

调节 VeSync 智能灯泡的亮度。

## 现状（2026-04-20）

- handler 先检查 device 匹配
- 再检查 `window.electronAPI.vesyncSetBrightness` 是否注册
- 没注册 → 返回「调光尚未支持」—— 用户当前设备多为插座/开关，无亮度通道
- 注册后（TODO）→ 调 VeSync bypassV2 `setBrightness` payload

## 和 `smart_device` 的区别

| 语句 | skill | 字段 |
|---|---|---|
| 开灯 / 关灯 | `smart_device` | action=on/off, device=灯 |
| 调暗卧室灯 | `light_dim` | device=卧室灯, level=30 |
| 灯调到 50 | `light_dim` | level=50 |
| 关所有灯 | `smart_device` | action=off, device=灯 |

router prompt 里的 R2 已经写了 ANTI-SUBSTITUTION 规则 —— 不许把 dim 塞成 toggle。
