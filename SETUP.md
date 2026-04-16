# XiaoZhi · 环境搭建指南（给 Claude Code 执行）

> 这份文档写给另一台机器上的 Claude Code，用来从零把 XiaoZhi 跑起来。用户是 showbox88，同一项目。

## 项目背景（Claude 必读）

- **目标**：基于 OpenWhispr (fork, MIT) 改造成一个叫"小智"的 Windows 漂浮窗语音助手
- **核心加法**：Workflow 引擎——LLM 判定意图后，读 `skills/*.md` 技能说明，把自然语言转成 JSON 派发给 webhook/API/智能家居
- **仓库**：https://github.com/showbox88/smart-voice （private）
- **完整规划**：见另一台机器 `~/.claude/plans/windows-win-drifting-hearth.md`（可能需要重新生成）
- **上游原项目**：https://github.com/OpenWhispr/openwhispr （已移除 remote，不会误推）

## 前置要求

| 工具 | 版本 | 验证命令 |
|------|------|---------|
| Node.js | **24.x 精确**（CI 锁死 24，别用 22/26） | `node --version` |
| npm | 11.x | `npm --version` |
| git | any | `git --version` |
| D 盘或大容量盘 | ≥ 10GB 可用 | - |

**没装 Node 24** → `winget install OpenJS.NodeJS.LTS` 然后重开终端。

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

## 后续开发路线图（还没做）

见 `windows-win-drifting-hearth.md` plan，Phase 3+ 还没开工：

- [ ] Phase 2：UI 重做成小漂浮球（当前还是 OpenWhispr 原生 UI）
- [ ] Phase 3 **核心**：Workflow 引擎
  - `src/helpers/skillLoader.js` — 读 `skills/*.md`
  - `src/helpers/router.js` — 模式分发（dictation / chat / workflow）
  - `src/helpers/skillDispatcher.js` — http/webhook/exec 派发
  - 两段式 LLM：选 skill → 填表
  - Settings 页加 skill 管理 UI
- [ ] Phase 4：唤醒词"小智小智"（Porcupine）+ TTS（SAPI / Voicebox）
- [ ] Phase 5：打包 NSIS 安装包、中文文档

当前代码基本是原版 OpenWhispr，Workflow 层完全还没写。

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
