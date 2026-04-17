# XiaoZhi · 环境搭建指南（给 Claude Code 执行）

> 这份文档写给另一台机器上的 Claude Code，用来从零把 XiaoZhi 跑起来。用户是 showbox88，同一项目。

## 项目背景（Claude 必读）

- **目标**：基于 OpenWhispr (fork, MIT) 改造成一个叫"小智"的 Windows 漂浮窗语音助手
- **核心加法**：
  1. TTS 输出（Edge Read Aloud + ElevenLabs 克隆，Phase 5 已完成）
  2. **Claude Code CLI 语音遥控**（Phase 6 已完成，说一句话 → 转文字 → 发给 `claude` CLI → 流式回复 + TTS 朗读）
  3. Workflow 引擎（Phase 3，仍待做）
- **仓库**：https://github.com/showbox88/smart-voice （private）
- **完整规划**：见另一台机器 `~/.claude/plans/windows-win-drifting-hearth.md`（可能需要重新生成）
- **上游原项目**：https://github.com/OpenWhispr/openwhispr （已移除 remote，不会误推）

## 前置要求

| 工具 | 版本 | 验证命令 |
|------|------|---------|
| Node.js | **24.x 精确**（CI 锁死 24，别用 22/26） | `node --version` |
| npm | 11.x | `npm --version` |
| git | any | `git --version` |
| Claude Code CLI | v2.1+（Phase 6 需要） | `claude --version` |
| D 盘或大容量盘 | ≥ 10GB 可用 | - |
| NVIDIA 驱动 | 新（CUDA 12+，用于 GPU Whisper） | `nvidia-smi` 看 CUDA Version 列 |

**没装 Node 24** → `winget install OpenJS.NodeJS.LTS` 然后重开终端。

**没装 Claude Code CLI** → `npm i -g @anthropic-ai/claude-code`，装完 `claude` → `/login` 登录你的 claude.ai 账号。

**NVIDIA 驱动老了**（CUDA 11.x 以下）→ 去 nvidia.com 下最新 Game Ready / Studio driver 装上重启，CUDA Whisper 才能加速。

## 一次性完整安装（按顺序跑）

### Step 1 — 克隆

```bash
# 如果 D:\Projects 不存在就创建
mkdir -p D:/Projects
cd D:/Projects
git clone https://github.com/showbox88/smart-voice.git XiaoZhi
cd XiaoZhi
```

### Step 2 — 建模型缓存 junction（重要，省 C 盘空间）

OpenWhispr 所有模型 (~1-3GB) 默认写到 `~/.cache/openwhispr`。用 junction 重定向到 D 盘。

```bash
# Windows 下 Claude Code 可用 cmd 执行（无需管理员权限）
mkdir -p "$USERPROFILE/.cache"
cmd //c "mklink /J \"$USERPROFILE\\.cache\\openwhispr\" D:\\Projects\\XiaoZhi-cache"

# 验证（应该输出 "->"  和 D:\Projects\XiaoZhi-cache）
ls -la "$USERPROFILE/.cache/openwhispr"
```

如果 junction 已存在 (`Cannot create a file when that file already exists`)，跳过这一步。

### Step 3 — npm install

```bash
cd D:/Projects/XiaoZhi
npm install
# 预期：15-30 分钟。721+ 模块。
# 会在 postinstall 阶段报错：
#   "node-gyp failed to rebuild '@sentry-internal/node-cpu-profiler'"
#   "Could not find any Visual Studio installation"
# ⚠️ 这个错误是预期的，不用管——那个包是 Sentry 云端错误上报的间接依赖，本地跑用不到。
# 主依赖已装完。
```

### Step 4 — 修复 better-sqlite3（关键）

postinstall 失败导致原生模块没针对 Electron 41 的 ABI 重新编译。better-sqlite3 必须跑起来否则数据库挂。用它的预编译包：

```bash
cd D:/Projects/XiaoZhi/node_modules/better-sqlite3
npx prebuild-install --runtime=electron --target=41.2.0 --arch=x64 --platform=win32
cd ../..

# 验证 .node 文件存在
ls node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

> 如果家里以后 Electron 升级了版本号，改 `--target=X.Y.Z` 对应新版本。

### Step 5 — 启动

```bash
cd D:/Projects/XiaoZhi
npm run dev
```

**首次启动预期行为**：
1. `predev` 下载约 **1GB** 二进制：
   - whisper.cpp、llama-server、sherpa-onnx、qdrant
   - MiniLM embedding 模型（86MB + tokenizer）
   - meeting-aec-helper、windows-key-listener 等
2. Vite dev server ready (~500ms)
3. Electron 窗口弹出，显示 "Welcome to OpenWhispr"（注意：UI 还是 OpenWhispr 的，后面再改成"小智"）

**可能遇到的错误**：

| 错误 | 修复 |
|------|------|
| `Port 5183 is already in use` | 有残留 vite 进程：`powershell -Command "Get-NetTCPConnection -LocalPort 5183 | Select-Object -ExpandProperty OwningProcess | % { Stop-Process -Id $_ -Force }"` |
| `Database initialization failed ... better_sqlite3.node` | Step 4 没跑，或 Electron 版本变了 |
| `STT config fetch error: {}` | ✅ 可忽略，是向 openwhispr.com 拉云配置失败，我们不用云 |
| `Cloud Not Configured` UI 提示 | ✅ 正常，这是云同步功能没配，本地功能不受影响 |

## 首次 Onboarding（App 启动后）

窗口会走 3 步：

1. **Setup → Transcription Setup**
   - 选 `Local`
   - 引擎：`NVIDIA Parakeet TDT 0.6B`（622MB，速度快）
     - 或 `OpenAI Whisper` → `Turbo`（1.6GB，中文更准但慢）
   - Preferred Language: `Chinese (Simplified)`
   - 点 Download 等模型下完（进 D:\Projects\XiaoZhi-cache）

2. **Permissions → Microphone**
   - 点 `Grant Access`
   - 如果显示 "No microphones were detected"：
     - 去 Windows 设置 → 隐私 → 麦克风 → 打开"允许桌面应用访问麦克风"
     - 检查物理麦克风是否连接

3. **Activation → 热键**
   - 默认 `` ` ``（反引号）push-to-talk
   - 建议改成 `Ctrl+Shift+Space` 或 `Alt+R`（可选）
   - 填 Agent 名字："**小智**"

## API Key 配置（Onboarding 后在 Settings 里）

用户有 Anthropic Claude API Key，从 https://console.anthropic.com/settings/keys 拿。
填到 Settings → AI Provider → Anthropic。

**API Keys 不在代码仓库里**，存在：
`C:\Users\<用户名>\AppData\Roaming\OpenWhispr-development\.env`

两台机器都要各自填一次（不要 commit 到 git）。

## 验证 "一切正常" 的最小场景

1. 光标放在任意输入框（记事本、微信、浏览器地址栏）
2. 按住热键 `` ` ``（或配的），说一句中文，松开
3. 文字应该 1-3 秒内出现在光标位置
4. 说"小智，今天天气怎么样"→ Overlay 弹出 Claude 流式回复

## Phase 5 · TTS 语音输出 (已完成)

Agent Mode 回复可以用语音读出来，两种 provider 可切换：

### Edge Read Aloud (免费, 默认)
- Control Panel → Settings → Agent Mode → 滚到最下面"语音输出"
- 开启开关，选 Tab "Edge Read Aloud (免费)"
- 下拉选音色：晓晓 / 晓伊 / 云希 / 云夏 / **东北话晓贝** / **陕西话晓妮** / 台湾曉臻 / 粤语曉曼 等 14 种
- 点试听验证

### ElevenLabs 克隆 (可选, 付费)
- elevenlabs.io 注册，**Voices → + Instant Voice Clone → 传 30s-1min 音频**
- 拿 API Key 和 Voice ID
- Settings → Agent Mode → 语音输出 → Tab "ElevenLabs (克隆)"
- 填 API Key (sk_...) + Voice ID，点试听
- 克隆音色会被 Agent 自动使用

**TTS 设置存储**（localStorage，每台机器独立）：
- `xiaozhi.tts.enabled` / `xiaozhi.tts.provider` / `xiaozhi.tts.voice`
- `xiaozhi.tts.elevenlabs.apiKey` / `xiaozhi.tts.elevenlabs.voiceId`

## Phase 6 · Claude Code CLI 语音遥控 (已完成)

**这是最重要的新功能**：说一句话 → XiaoZhi 转文字 → 发给 `claude` CLI 当作输入 → Claude 读文件/改代码/跑命令 → 回复流式出现 + 晓晓朗读。

### 前置条件

1. 装 Claude Code CLI：`npm i -g @anthropic-ai/claude-code`
2. 登录：打开任意目录跑 `claude`，输入 `/login` → 浏览器 OAuth（用 Pro/Max 账号）
3. 第一次进项目目录跑 `claude` 一次，过 workspace trust 提示

### 用法

1. XiaoZhi 跑起来，打开 Control Panel
2. **左栏底部** 有个 Terminal 图标的 **"Claude Code"** 条目，点进
3. 顶栏：
   - 点 **选目录** → 挑你要 Claude 操作的项目文件夹
   - **权限模式下拉** 默认 "自动批准文件编辑（推荐）"
     - `acceptEdits`：自动批准 Write/Edit，Bash 还会问（因 `--print` 模式没法问，实际就是不让跑）
     - `bypassPermissions`：全部自动过，包括 Bash（完全放手）
     - `plan`：只规划不执行
4. 底部：
   - **麦克风按钮**：点开始录，再点停止 → 转录自动填入文本框
   - 或直接打字
   - **Send** 按钮发送（Shift+Enter 换行，Enter 发送）
5. 回复：
   - 流式显示在灰色气泡
   - 工具调用显示 🔧 图标（Write / Bash / Read 等）
   - 每完成一句话立即 TTS 朗读（用 Agent Mode 设置的音色）
6. 右上 **新会话** 按钮 = 清空上下文，开始新 topic

### 实测例子

说："做一个简单的 hello world 网页，保存到桌面 test 文件夹"
- Claude 会调 Write 工具创建 `C:\Users\你\Desktop\test\index.html`
- 回复类似"已创建 hello-world 网页" → TTS 朗读

### 关键文件（以后改造时）

| 文件 | 作用 |
|------|------|
| `src/helpers/claudeCodeSession.js` | spawn `claude --print --output-format stream-json`，解析 NDJSON 事件 |
| `src/helpers/sentenceChunker.js` | 流式文本按句子 flush，给 TTS 用 |
| `src/helpers/ttsManager.js` | Edge + ElevenLabs 双 provider |
| `src/helpers/ipcHandlers.js` | `claude-code:*` 和 `tts-*` 的 IPC 处理器 |
| `src/components/ClaudeCodeView.tsx` | 主 UI（录音/文本框/Send/消息列表/权限下拉） |
| `src/components/ControlPanelSidebar.tsx` | 侧栏加 "Claude Code" 条目 |
| `src/components/settings/AgentModeSettings.tsx` | 里面有 TtsVoiceSettings 组件 |

### 已知限制 / 待做

- **没有全局热键**：必须从 Control Panel 进入（Phase 6.2 会做独立 overlay + Ctrl+Alt+C 热键）
- **无 Bash 工具自动批准对话**：用 `bypassPermissions` 模式才能跑命令
- **无工具使用细节展示**：只显示 🔧 图标，没显示具体参数和差异
- **session 持久化**：程序重启后 session_id 丢失，需要新会话

## 日常开发

```bash
# 启动 dev
cd D:/Projects/XiaoZhi && npm run dev

# 改完代码提交
git add -A
git commit -m "feat: 改了什么"
git push

# 另一台机器拉更新
git pull
# 如果 package.json 变了
npm install
```

## 路线图（已完成 vs 待做）

**已完成**：
- [x] Phase 1：基线跑通（OpenWhispr fork + Whisper Turbo + CUDA）
- [x] Phase 5：TTS（Edge Read Aloud + ElevenLabs），音色选择器，试听
- [x] Phase 6.1：Claude Code CLI 语音遥控 MVP（Control Panel 内面板）

**待做**：
- [ ] Phase 2：UI 重做成小漂浮球（当前还是 OpenWhispr 原生 UI）
- [ ] Phase 3 **核心**：Workflow 引擎
  - `src/helpers/skillLoader.js` — 读 `skills/*.md`
  - `src/helpers/router.js` — 模式分发（dictation / chat / workflow）
  - `src/helpers/skillDispatcher.js` — http/webhook/exec 派发
- [ ] Phase 4：唤醒词"小智小智"（Porcupine）
- [ ] Phase 6.2：Claude Code 独立 overlay + 全局热键 + tool_use 细节展示
- [ ] Phase 7：打包 NSIS 安装包、中文文档

## 关键文件位置（改造时参考）

| 文件 | 作用 |
|------|------|
| `main.js` | Electron 入口 |
| `src/helpers/ipcHandlers.js` | IPC 总入口（Workflow 的新 handler 加这里） |
| `src/helpers/hotkeyManager.js` | 热键注册 |
| `src/helpers/audioManager.js` | 录音管线 |
| `src/helpers/whisper.js` / `parakeet.js` | STT |
| `src/helpers/llamaServer.js` | 本地 LLM |
| `src/services/ReasoningService.ts` | AI 推理服务（当前对话逻辑） |
| `src/components/App.jsx` | 主听写界面 |
| `src/models/modelRegistryData.json` | 所有 AI 模型定义 |
| `CLAUDE.md`（仓库根目录） | OpenWhispr 原版架构文档，**必读** |

## 碰到问题怎么办

1. 先看 `DEBUG.md` 和 `TROUBLESHOOTING.md`（仓库里原版的）
2. 日志在 Electron userData 目录里
3. 用 `OPENWHISPR_LOG_LEVEL=debug` 打详细日志
