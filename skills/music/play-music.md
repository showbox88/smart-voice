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
    - 播放第
    - 第几首
    - 全部播放
    - 上次那首
    - 上次播放的
    - 之前听的
    - 轻柔的
    - 舒缓的
    - 欢快的
    - 点一首
  en:
    - play music
    - play a song
    - put on some music
    - play number
    - play track
    - last song
    - the one from before
    - something gentle
    - something upbeat
parameters:
  - name: query
    type: string
    required: false
    description: >-
      Fuzzy match against track filenames and folder names. Leave empty to
      shuffle-play everything. Do NOT fill this when the user references a
      track by its position number — use `number` instead.
    examples:
      - 周杰伦
      - 轻音乐
      - Coldplay
      - classical
  - name: number
    type: integer
    required: false
    description: >-
      1-based position in the list the user just saw via list_music. Fill this
      whenever the user refers to a track by its number ("第 3 首",
      "play number 3", "third one"). Leave `query` empty in this case.
    examples:
      - 3
      - 1
      - 12
  - name: mood
    type: string
    required: false
    description: >-
      Mood/vibe label from the user's library (e.g. "gentle", "轻柔",
      "upbeat", "sad"). Matches against the index's `user_meta.mood` or the
      ID3-derived mood. Use when the user asks by feel rather than by name
      ("来点轻柔的", "play something gentle", "放点舒缓的").
    examples:
      - gentle
      - 轻柔
      - upbeat
      - 欢快
  - name: tag
    type: string
    required: false
    description: >-
      Free-form tag from `user_meta.tags` or index tags. Use for arbitrary
      labels the user has set in the Music Library ("晨间", "workout",
      "focus").
    examples:
      - workout
      - 晨间
      - focus
  - name: genre
    type: string
    required: false
    description: >-
      Music genre from ID3 tags or user override. Use when the user names a
      genre explicitly ("play some jazz", "放点爵士").
    examples:
      - jazz
      - 流行
      - classical
  - name: artist
    type: string
    required: false
    description: >-
      Artist filter. Prefer this over `query` when the user clearly names an
      artist ("播放周杰伦的歌", "play anything by Coldplay"). Falls back to
      `query` if no artist metadata is in the index.
    examples:
      - 周杰伦
      - Coldplay
  - name: last_played
    type: boolean
    required: false
    description: >-
      Set true when the user asks to replay whatever was last played ("上次
      那首", "放上次那首", "play the last song again"). Resolves via the
      persisted agent-state.
    examples:
      - true
  - name: shuffle
    type: boolean
    required: false
    default: true
    description: >-
      Shuffle the resulting track list. Defaults to true when no query is given.
      Set false only if the user explicitly says "按顺序" / "in order" / "全部播放".
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

优先级从上往下:同一句话里同时命中多个时,上面的字段优先。

| 字段 | 从哪里抓 | 举例 |
|---|---|---|
| `number` | 用户说「第 N 首 / number N / the Nth one」时,抓那个数字。此时**不要填** `query` | "播放第 3 首" → `number: 3`；"第 12 首" → `number: 12` |
| `last_played` | 用户说「上次那首 / 之前那首 / play the last one」时,填 `true`。不要填其他字段 | "放上次那首" → `last_played: true` |
| `mood` / `tag` | 任意情绪/风格描述词（"轻柔/舒缓/欢快/gentle/upbeat/workout/晨间/focus"）—— 两个槽位等价,handler 会在索引里同时搜 mood、tags、genre 三列,选哪个都行。挑一个填就好 | "来点轻柔的" → `mood: "轻柔"` 或 `tag: "轻柔"`；"放个 workout 歌单" → `tag: "workout"` |
| `genre` | 用户明确说体裁（"爵士 / jazz / 流行 / classical"） | "来点爵士" → `genre: "jazz"` |
| `artist` | 用户清晰地点名歌手时,优先用 artist 而不是 query | "播放周杰伦的歌" → `artist: "周杰伦"` |
| `query` | 具体歌名或模糊关键词,且没有更明确的槽可用 | "放那首晴天" → `query: "晴天"` |
| `shuffle` | 默认 true；用户明确说「按顺序 / 全部播放」才填 false | "按顺序播放周杰伦" → `artist: "周杰伦"`, `shuffle: false` |

## 两步对话示例

```
用户: 列出曲目
助手: (list_music 显示编号列表，末尾提示「说播放第 N 首」)
用户: 播放第 3 首
助手: (play_music with number=3 → 正在播放：第 3 首 · …)
```

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
