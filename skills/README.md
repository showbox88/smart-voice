# Skills Library

Agent 的「能力」—— 每个技能一份 markdown 文件，改文件就能改行为。

## 目录结构

```
skills/                     ← 内置默认，跟代码走
  music/
    play-music.md           Skill name: play_music
    music-control.md        Skill name: music_control
    list-music.md           Skill name: list_music
  vesync/
    smart-device.md         Skill name: smart_device
    light-dim.md            Skill name: light_dim          (Phase B)
  climate/
    aircon.md               Skill name: aircon             (Phase B, stubbed)
  system/
    app-launcher.md         Skill name: app_launcher       (Phase B)
    reminder.md             Skill name: reminder           (Phase B)
  info/
    query.md                Skill name: info_query         (Phase B)
  messaging/
    messaging.md            Skill name: messaging          (Phase B, stubbed)

<userData>/skills/          ← 用户覆盖，同名 skill 胜出
```

**Phase B stubs**：`aircon` 和 `messaging` 目前 handler 返回「未配置」提示，但 router
照常把相关语句路由过来 —— 这样用户 UX 一致，以后接上 IR 发射器 / 邮件 SMTP 只要改
handler 就能激活。

`<userData>` 在 Windows 是 `%APPDATA%\OpenWhispr\skills\`，macOS 是
`~/Library/Application Support/OpenWhispr/skills/`，Linux 是
`~/.config/OpenWhispr/skills/`。

想自己改一个 skill：把内置文件复制到 `<userData>/skills/<category>/` 下，改 frontmatter，
重新发一条消息就生效（不用重启 App —— 每次 sendToAI 都会重新加载）。

## SKILL.md 结构

YAML frontmatter + markdown 正文。frontmatter 给机器看，正文给人看。

```yaml
---
name: play_music                    # ToolRegistry 里的 ID，LLM 看到的名字
category: music                     # 分组
description: "Start playing MP3 ..."  # 给 LLM 的工具简介
trigger_phrases:                    # 自动拼进 description 帮 LLM 选工具
  zh: [播放歌曲, 放歌]
  en: [play music]
parameters:                         # 表单字段
  - name: query
    type: string | number | boolean | enum | any
    required: false
    description: ...
    default: ...
    values: [...]                   # enum 用
    examples: [...]
handler: music.play                 # 指向 src/services/skills/handlers/ 里的函数
response_mode: passthrough | commentary | { template: "..." }
availability:                       # 前置条件不满足就不注册
  requires: [music_folder_configured, vlc_installed, vesync_logged_in]
---

# 正文是给人看的说明
```

## Response Modes（回复模式）

核心字段 —— 控制 Agent 发出工具结果后会不会继续说话。

| 模式 | 行为 | 用途 |
|---|---|---|
| `passthrough` | 工具返回 `displayText` 直接作为最终回复，**截断 LLM** | 命令类：播放、暂停、开关灯、调音量 |
| `commentary` | 工具结果回给 LLM，LLM 继续对话 | 查询类：搜笔记、列音乐、日历 |
| `template: "▶ {{firstTrack}}"` | 用模板格式化 metadata 字段 | 想要简短固定格式 |

## 可用的 availability flag

代码里定义在 [src/services/skills/skillLoader.ts](../src/services/skills/skillLoader.ts) 的 `AvailabilityContext`：

- `music_folder_configured` —— 用户在 Smart Home 里设置了音乐文件夹
- `vlc_installed` —— 检测到 vlc.exe
- `vesync_logged_in` —— VeSync 邮箱+密码都已保存

要加新 flag：改 `AvailabilityContext` + `useChatStreaming.ts` 里传入的值。

## 可用的 handler

代码里注册在 [src/services/skills/handlers/index.ts](../src/services/skills/handlers/index.ts)：

- `music.play` —— 播放（参数: query, shuffle）
- `music.control` —— 控制（参数: action, value）
- `music.list` —— 列曲目
- `vesync.control` —— 智能设备开关（参数: action, device）
- `vesync.dim` —— 灯光亮度调节（参数: device, level 0-100；VeSync 无亮度通道时 stub）
- `climate.aircon` —— 空调（参数: action, value；stub，待接 IR 发射器/厂商 API）
- `system.launchApp` —— 启动桌面 app（参数: app_name）
- `system.createReminder` —— 本地提醒（参数: message, when；SQLite 持久化 + setTimeout + Notification，重启后自动恢复）
- `info.query` —— 查询 time/date/weekday（weather/stock/news 返回「未接数据源」）
- `messaging.send` —— 发消息（参数: platform, recipient, content；stub，待接 SMTP/Twilio）

要加新 skill：写 handler 函数 → 注册到 `handlers/index.ts` → 写 `.md` 文件。
新增 IPC 通道的 skill 还要改 `preload.js`、`src/helpers/ipcHandlers.js`、
`src/types/electron.ts` 三处（例：`reminder:create` / `app:launch`）。

## 修改示例

**改播放反馈文字**
改 [src/services/skills/handlers/music.ts](../src/services/skills/handlers/music.ts) 里
`play()` 的 `displayText` —— 这是最终显示的文字。

**让 Agent 对某个 skill 变啰嗦**
把 `response_mode: passthrough` 改成 `response_mode: commentary`。

**加触发短语**
在 `trigger_phrases.zh` 数组里加新词。加完重新发一条消息就生效。

**临时停用一个 skill**
在 `availability.requires` 里加一个故意不满足的 flag（比如 `disabled`）。
