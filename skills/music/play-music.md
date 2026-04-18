---
name: play_music
category: music
description: >-
  Start playing MP3/audio from the user's configured music folder through VLC.
  Call this when the user asks to play music, songs, or a specific track.
trigger_phrases:
  zh:
    - 播放歌曲
    - 放歌
    - 播放音乐
    - 来点音乐
    - 听歌
    - 放首歌
    - 来首歌
  en:
    - play music
    - play a song
    - put on some music
parameters:
  - name: query
    type: string
    required: false
    description: >-
      Fuzzy match against track filenames and folder names. Leave empty to
      shuffle-play everything.
    examples:
      - 周杰伦
      - 轻音乐
      - Coldplay
      - classical
  - name: shuffle
    type: boolean
    required: false
    default: true
    description: >-
      Shuffle the resulting track list. Defaults to true when no query is given.
      Set false only if the user explicitly says "按顺序" / "in order".
handler: music.play
response_mode:
  template: "开始播放：{{firstTrack}}"
availability:
  requires:
    - music_folder_configured
    - vlc_installed
---

# Play Music

启动 VLC 播放本地音乐文件夹里的音频文件。

## 何时使用

用户说「播放歌曲」「放歌」「来首周杰伦」这类要启动播放的指令。

## 要从用户话里抓什么

| 字段 | 从哪里抓 | 举例 |
|---|---|---|
| `query` | 歌名、歌手、文件夹、风格关键词 | "放周杰伦" → `query: "周杰伦"`；"来点轻音乐" → `query: "轻音乐"` |
| `shuffle` | 默认 true；用户明确说「按顺序」才填 false | "按顺序播放周杰伦" → `shuffle: false` |

## 回复格式

`response_mode.template` —— 用模板渲染 handler 返回的 metadata 字段作为最终回复，LLM 不继续生成。

可用字段：
- `{{firstTrack}}` —— 正在播放的第一首（去掉扩展名）
- `{{queued}}` —— 队列长度
- `{{shuffle}}` —— 是否随机（true/false）

要改文字？直接改上面 frontmatter 里的 `template` 字符串。举例：

```yaml
response_mode:
  template: "▶ {{firstTrack}}（共 {{queued}} 首）"
```
