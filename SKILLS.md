# Skills Library — 设计方案

> 把 Agent 的「能力」从硬编码的 TS 文件里抽出来，变成可改的 markdown。修文件 → 重启 Electron → 行为变。
>
> 状态：**设计方案，尚未实现。** 所有路径用 `src/services/skills/` 作为新目录。

---

## 1. 为什么要做

**现状：** 每个动作（播放/暂停/下一首/开灯 ...）是 `src/services/tools/*.ts` 里一个独立工具。当前项目有 11 个（9 music + 2 vesync），以后会更多。问题：

1. **太碎** —— LLM 要在 10+ 工具里挑一个，容易选错。
2. **硬编码** —— 触发短语、参数描述、回复措辞、回复冗长度全写死在 TS 里。改一行"不要废话"得改代码重编译。
3. **Agent 啰嗦** —— 工具返回"正在播放：xxx.mp3"后，LLM 还会继续加"这是第一首～ 如果需要调整音量…"。没有机制让它闭嘴。

**目标：**

- 合并 11 → 4 个 skill。
- 每个 skill 一份 `.md` 文件：metadata 驱动 LLM，正文给人看。
- 每个 skill 声明自己的「回复模式」：`passthrough`（只显示工具返回，LLM 不加戏）/ `commentary`（让 LLM 发挥）/ `template`（按模板格式化）。
- 代码里只留 handler 胶水（模糊匹配、VLC 进程、IPC 调用）。

---

## 2. 目录结构

```
skills/                              # ← 新目录，根目录下
  music/
    play-music.md                    # skill: play_music
    music-control.md                 # skill: music_control
    list-music.md                    # skill: list_music
  vesync/
    smart-device.md                  # skill: smart_device
  README.md                          # 写给用户看的：怎么改 skill

src/services/skills/                 # ← 新目录，加载/执行层
  skillLoader.ts                     # 启动扫描 skills/*/*.md → 解析 → 注入 ToolRegistry
  skillExecutor.ts                   # response_mode 逻辑，template 渲染
  handlers/
    music.ts                         # export { play, control, list }
    vesync.ts                        # export { control }
    index.ts                         # handler name → function 映射
```

App 启动时 `skillLoader` 先扫 `app.getAsarUnpackedPath()/skills/`（内置默认），再扫 `userData/skills/`（用户覆盖），后者优先。这样升级 App 不会抹掉用户自定义。

---

## 3. SKILL.md 格式

YAML frontmatter（机器读）+ markdown 正文（人读）。

### 完整示例 —— `skills/music/play-music.md`

```markdown
---
name: play_music
category: music
description: >
  Start playing MP3/audio from the user's configured music folder through VLC.
  Call this when the user asks to play music, songs, or a specific track.

trigger_phrases:
  zh: [播放歌曲, 放歌, 播放音乐, 来点音乐, 听歌, 放首歌]
  en: [play music, play a song, put on some music]

parameters:
  - name: query
    type: string
    required: false
    description: Fuzzy match against track filenames and folder names.
    examples: [周杰伦, 轻音乐, Coldplay, classical]

  - name: shuffle
    type: boolean
    required: false
    default: true
    description: Shuffle the resulting track list. Default true when no query.

handler: music.play

response_mode: passthrough

availability:
  requires: [music_folder_configured, vlc_installed]
---

# Play Music

启动 VLC 播放本地音乐文件夹里的音频文件。

## 何时使用

用户说「播放歌曲」「放歌」「来首周杰伦」这类要启动播放的指令。

## 要从用户话里抓什么

| 字段 | 从哪里抓 | 举例 |
|---|---|---|
| `query` | 歌名、歌手、文件夹、风格关键词 | "放周杰伦" → `query: "周杰伦"`；"来点轻音乐" → `query: "轻音乐"` |
| `shuffle` | 用户明确说「按顺序」「随机」才填；默认 true | "按顺序播放周杰伦" → `shuffle: false` |

## 边界情况

- 用户只说「放歌」不指定 → `query` 留空，全库随机
- 用户说「放第一首」→ 这个 skill 不合适，应该先 `list_music` 看列表再 `play_music`
- 没配文件夹 / 没装 VLC → handler 返回错误文本，`passthrough` 直接显示给用户

## 回复格式

`response_mode: passthrough` —— 工具返回什么就显示什么，LLM 不继续生成。

handler 返回的 `displayText` 长这样：

```
正在播放：偏向 - 陈子晴.mp3
```

要改文字？改 `src/services/skills/handlers/music.ts` 里 `play()` 函数的 `displayText`。
```

### Frontmatter 字段表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✓ | 工具名，蛇形，LLM 看到的 ID |
| `category` | string | ✓ | 分组，UI 里可以折叠 |
| `description` | string | ✓ | 给 LLM 看的简介，影响工具选择 |
| `trigger_phrases` | `{zh,en}: [...]` | 否 | 自动拼进 description 帮助 LLM 匹配 |
| `parameters` | array | ✓ | 「表单字段」，每项：name/type/required/description/default/examples |
| `handler` | string | ✓ | `模块.函数` 指向 `src/services/skills/handlers/` |
| `response_mode` | enum 或 object | ✓ | 见第 4 节 |
| `availability.requires` | string[] | 否 | 前置条件，不满足就不注册到 ToolRegistry |

`parameters` 会被 `skillLoader` 转成 JSON Schema 喂给 LLM，和现在 `ToolDefinition.parameters` 等价。

---

## 4. Response Modes（回复模式）—— 核心

解决「Agent 啰嗦」的关键。

### 4.1 `passthrough`（默认用这个）

工具执行后，**不把结果回传给 LLM 继续生成**，直接把 `displayText` 当最终回复。

**用途：** 命令类技能 —— 播放 / 暂停 / 开关灯 / 调音量。用户要的是"动作反馈"，不是"对话"。

**实现点：** [src/components/chat/useChatStreaming.ts:251](src/components/chat/useChatStreaming.ts:251) `tool_result` 分支里加：

```ts
const skill = skillRegistry.get(toolName);
if (skill?.response_mode === "passthrough") {
  setMessages(prev => prev.map(m =>
    m.id === assistantId
      ? { ...m, content: chunk.displayText, isStreaming: false }
      : m
  ));
  ReasoningService.cancelActiveStream();
  break;  // 跳出 for-await，LLM 没机会再说话
}
```

### 4.2 `commentary`

当前行为 —— 工具返回给 LLM，LLM 继续对话。

**用途：** 查询类 —— `search_notes`、`list_music`、`calendar`、`web_search`。这些需要 LLM 解读总结。

### 4.3 `template`

用户写模板，工具返回的结构化 data 填进去。

```yaml
response_mode:
  template: "▶ {{firstTrack}}（队列 {{queued}} 首）"
```

**用途：** 想要简短、固定格式但需要动态字段。比 `passthrough` 更可控，比 `commentary` 更省 token。

模板引擎用最简单的 `{{key}}` 替换，不支持循环条件。复杂逻辑回 handler 里写。

---

## 5. 合并后的 4 个 Skill

| skill | 替代原工具 | 关键参数 | response_mode |
|---|---|---|---|
| `play_music` | `play_music` | `query`, `shuffle` | `passthrough` |
| `music_control` | `pause_music`, `next_music`, `previous_music`, `stop_music`, `set_music_volume`, `set_music_repeat`, `set_music_shuffle` | `action`, `value` | `passthrough` |
| `list_music` | `list_music` | — | `commentary` |
| `smart_device` | `list_smart_devices`, `set_device_power` | `action`, `device` | `passthrough` |

### `music_control` 参数设计

```yaml
parameters:
  - name: action
    type: enum
    values: [pause, next, previous, stop, volume, repeat, shuffle]
    required: true

  - name: value
    type: any  # 由 action 决定类型
    required: false
    description: >
      Payload for the action.
      - volume: number 0-100
      - repeat: "off" | "all" | "one"
      - shuffle: boolean
      - pause/next/previous/stop: omitted
```

handler 里一个 switch 分派：

```ts
// src/services/skills/handlers/music.ts
export async function control(args: { action: string; value?: unknown }) {
  switch (args.action) {
    case "pause":    return electronAPI.musicPause();
    case "next":     return electronAPI.musicNext();
    case "previous": return electronAPI.musicPrevious();
    case "stop":     return electronAPI.musicStop();
    case "volume":   return electronAPI.musicVolume(Number(args.value));
    case "repeat":   return electronAPI.musicSetRepeat(String(args.value));
    case "shuffle":  return electronAPI.musicSetShuffle(Boolean(args.value));
    default: return { success: false, displayText: `未知操作: ${args.action}` };
  }
}
```

LLM 在对话里看到"下一首"→ 填 `action: "next"`；"音量调到 60"→ `action: "volume", value: 60`；"单曲循环"→ `action: "repeat", value: "one"`。

---

## 6. Loader 架构

```ts
// src/services/skills/skillLoader.ts  (renderer)
interface LoadedSkill {
  name: string;
  description: string;
  parameters: JsonSchema;
  handler: (args) => Promise<ToolResult>;
  response_mode: "passthrough" | "commentary" | { template: string };
  availability: string[];
}

export async function loadAllSkills(): Promise<LoadedSkill[]> {
  // 1. IPC: main 进程读 app 内置 + userData 的 skills/*.md
  const rawFiles = await window.electronAPI.skillsLoadAll();
  // 2. 解析 frontmatter（gray-matter）
  // 3. 查 handler 映射表（handlers/index.ts）
  // 4. availability 过滤（音乐没配 / VLC 没装 → 跳过）
  // 5. 返回已绑定 handler 的 skill 列表
}
```

- **IPC handler `skills:load-all`**：main 进程，读两个目录合并，返回 raw 文件内容数组。
- **Handler 映射** 在 [src/services/skills/handlers/index.ts](src/services/skills/handlers/index.ts)：`{ "music.play": musicHandlers.play, "music.control": musicHandlers.control, ... }`。Skill 文件里 `handler: music.play` 就查这张表。
- **加载时机：** 每次 `sendToAI` 前调 `loadAllSkills()`（和现在 [useChatStreaming.ts:122](src/components/chat/useChatStreaming.ts:122) 的 availability 检查合并），保证用户改了 skill 文件不用重开 App（只要重新发一条消息就生效）。
- **ToolRegistry 注入：** 把 `LoadedSkill[]` 转成 `ToolDefinition[]` 塞进 `createToolRegistry`。

---

## 7. 迁移步骤

按顺序做，每步可独立验证：

1. **加框架**（不迁任何 skill）
   - 建目录 `skills/`、`src/services/skills/`
   - 写 `skillLoader.ts`、`skillExecutor.ts`、handler 映射
   - 加 IPC `skills:load-all`、preload 暴露
   - `useChatStreaming.ts` 增加 `passthrough` / `template` 分支，`commentary` 走原路

2. **迁 `play_music`（最简单的单动作）**
   - 写 `skills/music/play-music.md`
   - 写 `handlers/music.ts` 的 `play()`（逻辑从 `src/services/tools/musicTool.ts` 搬过来）
   - 从 `src/services/tools/index.ts` 删掉 `playMusicTool` 注册
   - 验证：说"播放音乐"→ VLC 开，Agent 只回一行「正在播放：xxx.mp3」

3. **合并 7 个控制工具 → `music_control`**
   - 写 `skills/music/music-control.md`
   - `handlers/music.ts` 加 `control()` switch
   - 删 `pauseMusicTool`/`nextMusicTool`/...7 个
   - 验证：「下一首」「音量 50」「单曲循环」逐个试

4. **迁 `list_music`**
   - 最简单，`response_mode: commentary`，行为不变

5. **合并 VeSync → `smart_device`**
   - 类似 music_control

6. **清理旧代码**
   - 删 `src/services/tools/musicTool.ts`、`vesyncTool.ts`
   - 删 `src/config/prompts.ts` 里 `TOOL_INSTRUCTIONS` 的 music/vesync 条目（trigger_phrases 从 skill 文件读）
   - `src/services/tools/index.ts` 保留其他 skill（notes、search、clipboard），music/vesync 走新 loader

---

## 8. 验证

每步迁移后：

- [ ] 启动 App，打开 Agent 聊天
- [ ] 说「播放音乐」→ VLC 开，回复 **只有**「正在播放：xxx.mp3」（没有"这是第一首～"之类）
- [ ] 说「暂停」「下一首」「音量 30」「单曲循环」→ 各自一行动作反馈
- [ ] 说「关灯」→ VeSync 调用 + 一行反馈
- [ ] 手动改 `skills/music/play-music.md` 的 description，发新消息 → 行为变化（不用重启 App）
- [ ] 删除 `~/AppData/Roaming/OpenWhispr/skills/music/play-music.md` → 回退到内置默认
- [ ] 没配音乐文件夹时 → music 类 skill 不出现在工具列表（availability 生效）

---

## 9. 不在这个方案里（以后再说）

- Skill 的**编辑 UI**。现在只能手改 markdown。
- **远程同步** skills 库。
- **插件市场**。用户只能用内置的 + 自己放进去的。
- Skill **版本号 / 迁移**。
- **多语言 description**（现在靠 trigger_phrases.zh/en，description 保持英文给 LLM）。

---

## 文件清单（实现时要动的）

**新建：**
- `skills/music/play-music.md`
- `skills/music/music-control.md`
- `skills/music/list-music.md`
- `skills/vesync/smart-device.md`
- `skills/README.md`
- `src/services/skills/skillLoader.ts`
- `src/services/skills/skillExecutor.ts`
- `src/services/skills/handlers/music.ts`
- `src/services/skills/handlers/vesync.ts`
- `src/services/skills/handlers/index.ts`

**修改：**
- `main.js` —— 初始化 skills 目录（copy 内置到 userData）
- `src/helpers/ipcHandlers.js` —— 加 `skills:load-all` handler
- `preload.js` —— 暴露 `skillsLoadAll`
- `src/types/electron.ts` —— 类型
- `src/components/chat/useChatStreaming.ts` —— `passthrough` / `template` 分支
- `src/services/tools/index.ts` —— 移除 music/vesync 注册，改由 skill loader

**删除：**
- `src/services/tools/musicTool.ts`
- `src/services/tools/vesyncTool.ts`

**依赖：** 需要加 `gray-matter` npm 包（YAML frontmatter 解析）。
