# OpenWhispr Lite

**完全独立** 的极简语音听写工具 — 不依赖主程序,任何 Windows 电脑装上就能跑。

只做一件事:**按小键盘 `.` → 听 → 转文字 → 贴到光标处**。

无 agent、无 LLM、无设置面板、无 onboarding。代码量约 400 行 + 一个安装脚本。

## 安装(全自动)

要求:**Windows + Node.js 18+**(`node -v` 能跑)。

```powershell
cd lite
npm install
```

`npm install` 会自动:
1. 装 Electron(运行框架,~100MB)
2. 装 ffmpeg-static(音频转码,~80MB)
3. 下载 whisper-server CPU 版到 `lite/bin/`(~7MB)
4. 下载 whisper base 模型到 `lite/models/`(~142MB,**只此一次**)

总下载量约 330MB,首次约 3-5 分钟(视网速)。之后启动是秒级。

## 启动

```powershell
npm start
```

或者双击 `start.bat`。

启动后:屏幕右下角出现紫色小球(idle)。

## 用法

| 操作 | 效果 |
|---|---|
| 按小键盘 `.` | 球变蓝 → 开始录音 |
| 再按小键盘 `.` | 球变橙 → 转写 → 自动粘贴到当前聚焦的输入框 → 球回紫色 |
| 关闭(无 UI,用任务管理器结束 Electron) | 退出 |

## 改模型 / 改语言

编辑 `config.json` 后重启:

```json
{
  "model": "base",
  "language": "auto"
}
```

可选模型(默认只下载 base,其他要自己下):
- `base` — 142MB,日常足够
- `small` — 466MB,稍准
- `medium` — 1.5GB,准确
- `large-v3-turbo` — 1.6GB,最准

下载其他模型:把对应 `ggml-{name}.bin` 放到 `lite/models/` 即可。HuggingFace 下载链接:
`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{name}.bin`

语言可选 `auto` / `zh` / `en` / `ja` / `ko` 等(58 种)。中文(`auto` 或 `zh`)会自动添加提示词偏置简体输出。

## 故障排查

**安装阶段**
- 卡在下载 → `npm run setup` 重试(只下载缺失的)
- 公司网络挡 GitHub → 用代理:`set HTTPS_PROXY=http://proxy:port && npm install`
- 网速太慢 → 自己访问下面两个 URL 手动下,把文件放到对应位置:
  - `https://github.com/OpenWhispr/whisper.cpp/releases/latest/download/whisper-server-win32-x64-cpu.zip` → 解压后改名 `lite/bin/whisper-server-win32-x64.exe`
  - `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin` → `lite/models/ggml-base.bin`

**运行阶段**
- 球不出现 → 控制台看是否 `numdec` 热键被占
- 按 `.` 没反应 → 其他 app 抢了小键盘 `.`(常见于游戏)
- 录音变橙后弹错误 → 看错误框文字,通常是模型或二进制路径问题
- 转写为空 → 说话时长 < 0.5 秒被丢弃
- 粘贴没动静 → 用了 PowerShell SendKeys 回退,需要当前聚焦窗口能接收 Ctrl+V

## 性能(参考)

CPU 版 + base 模型 + 中等 CPU(i5-12代/Ryzen 5):
- 冷启动(首次按 `.`):录音瞬间开始,**转写阶段**多 1-2 秒(server 启动)
- 后续:5 秒中文录音,约 0.8-1.5 秒拿到文字
- 想更快 → 把主项目的 `whisper-server-win32-x64.exe`(CUDA 版本)+ `cublas*.dll` `cudart*.dll` 拷到 `lite/bin/` 覆盖

## 文件结构

```
lite/
├── package.json          # electron + ffmpeg-static
├── main.js               # Electron 主进程
├── preload.js            # IPC 安全桥
├── config.json           # 模型 + 语言
├── start.bat             # Windows 双击启动
├── .gitignore
├── scripts/
│   └── setup.js          # postinstall 钩子:下载 whisper + 模型
├── bin/                  # (自动生成) whisper-server.exe
├── models/               # (自动生成) ggml-base.bin
├── node_modules/         # (自动生成) electron, ffmpeg-static
└── renderer/
    ├── index.html
    ├── orb.css           # 3 状态样式
    └── orb.js            # MediaRecorder
```

## 跟主程序的关系

完全 **解耦**:
- 不读主程序的二进制(`lite/bin/` 优先)
- 不读主程序的 ffmpeg(`lite/node_modules/ffmpeg-static/` 优先)
- 不读主程序的模型缓存,**但** 如果你已经有 `~/.cache/openwhispr/whisper-models/ggml-*.bin`,会作为兜底使用 — 省一次下载
- 不读主程序的设置 / API key / 数据库
