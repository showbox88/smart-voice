---
name: list_music
category: music
description: >-
  List the music tracks in the user's configured music folder, numbered and
  sorted by artist. Use this when the user asks what music is available, or
  before play_music if the user's request is ambiguous. After listing, the user
  can say "播放第 N 首" / "play number N" and play_music will resolve the number
  against the list just shown.
trigger_phrases:
  zh:
    - 我有什么歌
    - 列出音乐
    - 列出曲目
    - 有哪些歌
    - 音乐列表
    - 歌曲列表
    - 曲目列表
  en:
    - list music
    - list songs
    - list tracks
    - what songs do i have
    - show my music
parameters: []
handler: music.list
response_mode: passthrough
availability:
  requires:
    - music_folder_configured
---

# List Music

列出音乐文件夹里的曲目。前 15 首显示编号,末尾提示用户"说播放第 N 首"接续下一步。

## 何时使用

- 用户问「我有哪些歌 / 列出曲目」
- `play_music` 找不到用户要的那首,想先看看库里有什么再决定

## 两步对话

此技能配合 `play_music` 的 `number` 参数使用:

1. 用户说「列出曲目」→ 本技能返回编号列表 + 末尾提示
2. 用户说「播放第 3 首」→ `play_music` 用 `number: 3` 直接播放列表里的第 3 首

## 回复格式

`response_mode: passthrough` —— 直接把 handler 的 `displayText` 原样显示,LLM 不要重新组织或总结(编号要原样保留,否则下一步的 number 参数会对不上号)。
