---
name: smart_device
category: smart_home
description: >-
  Control VeSync smart home devices (lights, plugs, switches). One unified tool
  that lists devices or turns them on/off/toggle. Device names are fuzzy-matched —
  users may say "Light 1", "灯一", "第一盏灯", "light one".
trigger_phrases:
  zh:
    - 开灯
    - 关灯
    - 打开
    - 关闭
    - 开一号灯
    - 关二号灯
    - 列出设备
    - 有哪些智能设备
  en:
    - turn on the light
    - turn off the light
    - list devices
    - what smart devices do i have
parameters:
  - name: action
    type: enum
    required: true
    values:
      - list
      - "on"
      - "off"
      - toggle
    description: >-
      'list' returns all devices. 'on'/'off' sets power state. 'toggle' flips it.
  - name: device
    type: string
    required: false
    description: >-
      Device name or identifying fragment. Required for action=on/off/toggle,
      ignored for action=list. Fuzzy-matched — pass what the user said
      (e.g. "Light 1", "灯二", "第三盏灯").
handler: vesync.control
response_mode: passthrough
availability:
  requires:
    - vesync_logged_in
---

# Smart Device

控制 VeSync 账号下的智能设备（灯、插座、开关）。

## 参数映射

| 用户说 | action | device |
|---|---|---|
| 列出设备 / 有哪些智能设备 | `list` | — |
| 开一号灯 / 打开 Light 1 | `on` | `"灯一"` 或 `"Light 1"` |
| 关闭所有灯 → 先 `list`，再逐个 `off` | `off` | `<name>` |
| 切换一号灯 | `toggle` | `"灯一"` |

## 回复格式

`response_mode: passthrough` —— 单行反馈。

handler 返回样例：
- `已打开「Light 1」`
- `已关闭「灯二」`
- `设备「灯三」当前离线`
- `找到 4 个智能设备`（action=list 时）
