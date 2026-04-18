---
name: music_control
category: music
description: >-
  Control currently-playing music in VLC. One unified tool covering pause /
  resume / next / previous / stop / volume / repeat / shuffle.
trigger_phrases:
  zh:
    - 暂停
    - 继续播放
    - 下一首
    - 上一首
    - 停止播放
    - 音量
    - 调大音量
    - 调小音量
    - 循环播放
    - 列表循环
    - 单曲循环
    - 取消循环
    - 随机播放
    - 按顺序播放
  en:
    - pause
    - resume
    - next track
    - previous track
    - stop
    - volume
    - loop
    - repeat
    - shuffle
parameters:
  - name: action
    type: enum
    required: true
    values:
      - pause
      - next
      - previous
      - stop
      - volume
      - repeat
      - shuffle
    description: >-
      The control action. 'pause' toggles pause/resume. 'next'/'previous' skip
      tracks. 'stop' ends playback and closes VLC. 'volume'/'repeat'/'shuffle'
      need a value in the next parameter.
  - name: value
    type: any
    required: false
    description: >-
      Action payload. For action=volume: number 0-100. For action=repeat:
      string "off" | "all" | "one". For action=shuffle: boolean true|false.
      For pause/next/previous/stop: omit.
handler: music.control
response_mode: passthrough
availability:
  requires:
    - music_folder_configured
    - vlc_installed
---

# Music Control

给当前正在 VLC 里播放的音乐发控制指令。

## 参数映射

| 用户说 | action | value |
|---|---|---|
| 暂停 / 继续 | `pause` | — |
| 下一首 | `next` | — |
| 上一首 | `previous` | — |
| 停止 / 关掉 | `stop` | — |
| 音量 30 / 调到 30 | `volume` | `30` |
| 列表循环 / 循环播放 | `repeat` | `"all"` |
| 单曲循环 / 重复这首 | `repeat` | `"one"` |
| 取消循环 / 关闭循环 | `repeat` | `"off"` |
| 随机播放 / 打乱 | `shuffle` | `true` |
| 按顺序播放 | `shuffle` | `false` |

## 回复格式

`response_mode: passthrough` —— 只显示一行动作反馈，LLM 不加戏。

handler 返回样例：
- `已切换到下一首`
- `音量已设为 30%`
- `已单曲循环`
- `已开启随机播放`
