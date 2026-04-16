# 小智 · Windows 漂浮语音助手

## Context

目标：做一个常驻 Windows 桌面的小巧漂浮窗语音助手，交互比官方 Win+H 更强。

核心诉求：
1. 漂浮麦克风图标 + 点击/热键/唤醒词三种触发
2. 本地 Whisper 做 STT，把语音转成文字
3. 转出的文字可 (a) 注入当前焦点输入框，或 (b) 进入 AI 对话
4. AI 后端支持云端(Claude/OpenAI/DeepSeek) + 本地(Ollama) 切换
5. **Workflow 路由**：LLM 判定意图后，读取对应的 `.md` 技能说明，把自然语言转成该技能的 JSON，派发给 webhook / API / 智能家居
6. AI 回复可用 Voicebox 做高质量 TTS 读出来

不做 / 后期：多语言 UI、插件市场、移动端。

## 起点：Fork OpenWhispr

基础能力已 90% 具备，直接 fork 改造省 2-3 周：
- 仓库：https://github.com/OpenWhispr/openwhispr
- 已有：Electron + TS、Agent Overlay（玻璃拟态聊天窗）、本地 Whisper / Parakeet、多家 LLM provider streaming、SendInput 光标注入、全局热键、跨平台
- 参考仓库：
  - `speech-to-windows-input` — SendInput 中文/日文处理可借鉴
  - `whisper.cpp` / `faster-whisper` — STT 引擎
  - `Porcupine` (garbit/whisper-voice-assistant) — 唤醒词

## 架构

```
┌─────────────────────────────────────────┐
│  Floating Orb (always-on-top, ~60×60)   │  ← Electron BrowserWindow (transparent, frameless)
│   idle → listening → thinking → speaking│
└──────────────┬──────────────────────────┘
               │ IPC
┌──────────────▼──────────────────────────┐
│  Main Process (Node)                    │
│  ├─ HotkeyManager (globalShortcut)      │
│  ├─ WakeWordEngine (Porcupine, 后期)    │
│  ├─ AudioCapture → VAD → Whisper        │
│  ├─ Router ────────────────────────┐    │
│  │   ├─ mode: dictation → SendInput│    │
│  │   ├─ mode: chat      → LLM      │    │
│  │   └─ mode: workflow  → Skill    │    │
│  ├─ LLMProvider (Claude|OpenAI|Ollama)  │
│  ├─ SkillLoader (读 skills/*.md)        │
│  ├─ Dispatcher (HTTP/webhook/exec)      │
│  └─ TTSProvider (System SAPI | Voicebox)│
└─────────────────────────────────────────┘
```

## 关键模块设计

### 1. 触发层
- **全局热键**：`Ctrl+Shift+Space` 按住说话，松开结束。用 Electron `globalShortcut`
- **点击麦克风图标**：切换录音/停止
- **唤醒词"小智小智"**：Porcupine 自训练 ppn 模型，后期加，默认关闭

### 2. 模式路由（关键创新点）

一次录音的 transcript 进入 Router，按顺序判断：

```
1. 当前焦点是编辑控件 + 用户选了"听写模式" → 直接 SendInput 注入
2. 用户开头说了指令前缀（"执行XX"/"帮我XX"）→ Workflow 模式
3. 默认 → Chat 模式（Agent Overlay 显示对话）
```

Workflow 模式流程：
```
transcript
  → LLM 一次调用：给它所有 skill 的 name+description 列表，让它选一个（或返回"不匹配"）
  → 命中 → 读 skills/<name>.md 全文喂给 LLM，要求按 md 里的 JSON Schema 填表
  → 校验 JSON → 按 md 里配的 target 派发
       - http: POST {url} body={json}
       - webhook: 同上
       - exec: 执行命令行（白名单，沙箱）
       - mqtt / homeassistant: 后期加
  → 结果回传 Agent Overlay + TTS 播报
```

### 3. 技能文件格式 `skills/*.md`

示例 `skills/turn-on-light.md`：
```markdown
---
name: turn_on_light
description: 控制客厅/卧室/书房的灯开关
triggers: ["开灯", "关灯", "把灯"]
target:
  type: http
  url: http://192.168.1.20:8123/api/services/light/turn_on
  headers: { Authorization: "Bearer {{HA_TOKEN}}" }
schema:
  entity_id: string  # 如 light.living_room
  brightness: number # 0-255, 可选
---

## 用法说明（喂给 LLM）

用户可能说：
- "把客厅的灯打开" → entity_id=light.living_room
- "卧室灯调暗一点" → entity_id=light.bedroom, brightness=80
...
```

Loader 用 gray-matter 解析 frontmatter，正文作为 prompt context。

### 4. LLM Provider 抽象

保留 OpenWhispr 现有的 `providers/` 结构，确认包含：
- AnthropicProvider (Claude)
- OpenAIProvider
- OllamaProvider
- 新增 DeepSeekProvider（国内用户友好，便宜）

UI：设置页下拉切换 + 每个 skill 可单独指定用哪个模型（重要的用 Claude，日常用本地 Qwen）。

### 5. TTS

- 默认：Windows SAPI（零依赖）
- 高级：Voicebox REST API (http://localhost:7860) — 需要用户自己装 Voicebox 并启动
- 设置页开关 + 音色选择

### 6. 漂浮球 UI

- 玻璃拟态小圆球，60×60，右下角默认位置可拖
- 状态动画（用 Lottie 或 CSS）：
  - idle: 缓慢呼吸
  - listening: 外圈声波跟随麦克风音量
  - thinking: 旋转粒子
  - speaking: 脉冲波纹
- 右键菜单：切换模式、打开设置、退出

## 改造 OpenWhispr 的具体工作

路线图（基于 fork 后的改动）：

**Phase 1 · 跑通基线（1-2 天）**
- clone & build OpenWhispr，确认中文 Whisper 模型可用
- 配置 Claude + 本地 Ollama provider
- 验证 SendInput 中文注入（可能要补 Unicode 处理）

**Phase 2 · UI 重做（3-5 天）**
- 把默认 overlay 改成小漂浮球 + 展开式聊天面板
- 状态动画 + 拖拽 + 记忆位置
- 中文 UI 文案

**Phase 3 · Workflow 引擎（1 周，核心）**
- 新建 `src/skills/` 目录 + loader
- Router 增加 workflow 分支
- 两段式 LLM 调用（选 skill → 填表）
- Dispatcher（先实现 http/webhook/exec 三种）
- 设置页里加 skill 管理界面（列表、启用/停用、打开 md 编辑）

**Phase 4 · 唤醒词 + TTS（3-5 天）**
- 集成 Porcupine，自训"小智小智"
- SAPI TTS + Voicebox provider

**Phase 5 · 打磨**
- 打包成 NSIS 安装包，开机自启选项
- 日志 + 崩溃上报（可选）
- 中文文档 + 示例 skill 包

## 需要修改的关键文件（fork 后会确认）

- `src/main/hotkey.ts` — 全局热键
- `src/main/audio.ts` — 录音/VAD
- `src/main/stt/whisper.ts` — Whisper 调用
- `src/main/providers/*` — LLM 后端
- `src/main/router.ts` — **新增**，模式分发
- `src/main/skills/loader.ts` — **新增**
- `src/main/skills/dispatcher.ts` — **新增**
- `src/main/inject.ts` — SendInput（可能用 `node-key-sender` 或自写 Rust addon）
- `src/renderer/Orb.tsx` — **重做** 漂浮球
- `src/renderer/Settings/Skills.tsx` — **新增**

## 验证方式

端到端场景：
1. 按 `Ctrl+Shift+Space` 说"今天北京天气怎么样"→ Agent Overlay 出现 Claude 流式回答，SAPI 读出
2. 焦点放在微信输入框，切听写模式，说"晚上八点我家见"→ 文字注入微信
3. 说"把客厅灯打开"→ 命中 skill `turn_on_light` → POST HomeAssistant → overlay 显示"已开灯"
4. 说"小智小智，现在几点"→ 唤醒 + 回答

## 风险 & 开放问题

- **OpenWhispr 许可证**：需要确认是 MIT/Apache 还是 GPL，决定能否闭源分发
- **Whisper 中文识别率**：large-v3 够用但慢，medium 速度好但常识性短语易错；要实测
- **SendInput 对中文输入法的兼容**：某些应用（微信桌面版、游戏）可能拦截；需要降级到剪贴板方案
- **唤醒词隐私**：Porcupine 全本地，但持续听会占 3-5% CPU，默认关闭
- **Skill 的 `exec` 类型**：执行本地命令有安全风险，必须做白名单 + 签名
