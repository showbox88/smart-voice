---
name: smart_device
category: smart_home
description: >-
  Control VeSync smart home devices (lights, plugs, switches). One unified tool
  that lists devices or turns them on/off/toggle. IMPORTANT: always call this
  tool directly — never ask the user to clarify which device when they say a
  generic command. For generic "开灯/关灯/turn on the light" pass device="灯".
  For "全部打开/全部关闭/all off" pass device="全部". For "所有插座关" pass
  device="插座". The handler auto-matches every device in that class. Only ask
  for clarification if device listing returned zero devices.
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
      Device name or identifying fragment. REQUIRED whenever action is on/off/toggle
      (ignored for action=list). Fuzzy-matched. Examples — specific: "Light 1",
      "灯二", "第三盏灯". Generic class (user didn't name a specific device): pass
      "灯" for any light command, "插座" for any plug, "开关" for any switch,
      "全部" / "所有" for every device regardless of type. NEVER leave this empty
      for on/off/toggle and NEVER ask the user to clarify — always guess the class
      from the sentence and let the handler fuzzy-match.
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
| 开灯 / 关灯（没指定具体哪盏） | `on` / `off` | `"灯"` |
| 所有灯打开 / 全部灯关 | `on` / `off` | `"灯"` |
| 全部打开 / 全部关闭 / 所有设备关 | `on` / `off` | `"全部"` |
| 切换一号灯 | `toggle` | `"灯一"` |

**重要：** `device` 字段必须有值。用户没指定具体设备时按上表传通用词（`"灯"` / `"全部"` / `"插座"` / `"开关"`），handler 会自动批量命中所有该类设备。**不要**返回 "缺少设备名称" —— 那个错误只在你真的没传 device 时才会出现。

## 回复格式

`response_mode: passthrough` —— 单行反馈。

handler 返回样例：
- `已打开「Light 1」`
- `已关闭「灯二」`
- `已关闭「light1」、「light 2」`（批量）
- `设备「灯三」当前离线`
- `找到 4 个智能设备`（action=list 时）
