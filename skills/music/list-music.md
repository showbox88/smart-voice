---
name: list_music
category: music
description: >-
  List the music tracks in the user's configured music folder. Returns up to 50
  track names. Use this when the user asks what music is available, or before
  play_music if the user's request is ambiguous and you want to check what's in
  the library.
trigger_phrases:
  zh:
    - 我有什么歌
    - 列出音乐
    - 有哪些歌
    - 音乐列表
  en:
    - list music
    - what songs do i have
    - show my music
parameters: []
handler: music.list
response_mode: commentary
availability:
  requires:
    - music_folder_configured
---

# List Music

列出音乐文件夹里的曲目（最多 50 首）。

## 何时使用

- 用户问「我有哪些歌」
- `play_music` 找不到用户要的那首，想先看看库里有什么再决定

## 回复格式

`response_mode: commentary` —— 让 LLM 看到列表后总结。典型场景：用户说「有哪些轻音乐」，LLM 可以从列表里筛选并推荐几首。
