# OpenWhispr Lite

极简版本 — 只做一件事:**按小键盘 `.` → 听 → 转文字 → 贴到光标处**。

无 agent、无 LLM、无设置面板、无 onboarding、无音乐/日历/会议检测。
代码量约 400 行,8 个文件。

## 前置条件

主项目 (`E:\Project\Voice\`) 必须先跑过一次,以下两样东西要存在:

1. **whisper-server 二进制**:`E:\Project\Voice\resources\bin\whisper-server-win32-x64.exe`
2. **whisper 模型**:`%USERPROFILE%\.cache\openwhispr\whisper-models\ggml-base.bin`

如果用别的位置,在启动前设置环境变量:`set LITE_BIN_DIR=C:\path\to\bin`

## 启动

```powershell
cd lite
npm install
npm start
```

启动后:屏幕右下角出现紫色圆球(idle)。

## 用法

| 操作 | 效果 |
|---|---|
| 按小键盘 `.` | 球变蓝 → 开始录音 |
| 再按小键盘 `.` | 球变橙 → 转写 → 自动粘贴到当前聚焦的输入框 → 球回紫色 |
| 关闭球(无 UI,用任务管理器结束 `Electron`) | 退出 app |

## 改模型 / 改语言

编辑 `config.json`,然后重启:

```json
{
  "model": "medium",      // base | small | medium | large-v3-turbo
  "language": "auto"      // auto | zh | en | ja | ...
}
```

模型文件名规则:`%USERPROFILE%\.cache\openwhispr\whisper-models\ggml-{model}.bin`。
不存在的模型会在控制台报错。

## 故障排查

- **球不出现**:控制台看是否有 hotkey 注册失败 (`numdec` 被占用)
- **按 `.` 没反应**:其他 app 占用了小键盘 `.` 全局热键
- **录音变橙后弹错误框**:`whisper-server` 二进制或模型缺失,见上面的"前置条件"
- **转写空 / 不准**:试试更大的模型 (medium / large-v3-turbo)
- **粘贴失败**:有 `windows-fast-paste.exe` 时走它,否则回退 PowerShell `SendKeys`,要求当前聚焦窗口能接收 Ctrl+V

## 文件结构

```
lite/
├── package.json          # 唯一依赖 electron
├── main.js               # 主进程: 窗口/热键/whisper-server/paste
├── preload.js            # IPC 安全桥
├── config.json           # 模型 + 语言
├── renderer/
│   ├── index.html        # 一个 <div>
│   ├── orb.css           # 3 状态样式
│   └── orb.js            # MediaRecorder + IPC
└── README.md             # 本文件
```
