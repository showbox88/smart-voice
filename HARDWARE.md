# XiaoZhi · 硬件配置与性能踩坑记录

这份文档记录在两台机器上把 XiaoZhi 调到秒出的实战经验。所有坑都是真踩过的,不是推测。

## 两台机器配置对照

| 项目 | 家里 | 办公室 |
|------|------|--------|
| GPU | RTX 3060 **12GB** | RTX 2060 **6GB** |
| Compute Capability | 8.6 (Ampere) | 7.5 (Turing) |
| Flash Attention (`-fa`) | ✅ 原生支持 | ⚠️ 部分 head 维度支持,可能静默回退 |

**关键差异**:显存差 2 倍,决定了能同时加载多大的模型组合。

## 推荐配置(按机器)

### 家里 3060 12GB — 追求质量

| 组件 | 模型 | 显存 |
|------|------|------|
| STT | Whisper **medium** CUDA | ~2GB |
| Intelligence(清理) | Qwen3 **4B** Q4_K_M | ~3GB |
| Agent Mode | Qwen3 **4B** Q4_K_M(复用) | 0(同模型) |
| KV cache | ctx 8K | ~1GB |
| **总占用** | | **~6GB** |

### 办公室 2060 6GB — 保命配置

| 组件 | 模型 | 显存 |
|------|------|------|
| STT | Whisper **small** CUDA | ~700MB |
| Intelligence(清理) | Qwen3 **1.7B** Q4_K_M | ~1.3GB |
| Agent Mode | Qwen3 **1.7B** Q4_K_M(复用) | 0(同模型) |
| KV cache | ctx 8K(紧张时降到 4K) | ~500MB |
| **总占用** | | **~2.5GB** |

留 3-4GB 给系统、Chrome、Electron 渲染进程。

### 想更快? 关掉清理最立竿见影

Settings → Intelligence → **Enable text cleanup** 关掉。
整个 LLM 步骤跳过,Whisper 出来直接贴。3.3 秒音频从录完到贴出 <1 秒。

## 踩过的坑(按严重程度)

### 1. ⛔ Qwen3.5 是陷阱,不是 Qwen3 的升级

**症状**:选了 UI 里标"Recommended"的 Qwen3.5 系列,推理慢到 100 秒出 10 字,比 CPU 还慢。

**原因**:Qwen3.5 是 **混合 Mamba+Attention 架构**(SSM 层 + 每 4 层 1 层真 attention)。llama.cpp 的 CUDA kernel 对这种混合架构支持很新,没优化透,RTX 3060 上跑不到 5 tok/s。

**判断方法**:GGUF metadata 里有 `qwen35.ssm.*` 字段 = 混合架构,直接弃用。

**正确选择**:
- Qwen3 4B / 1.7B(**纯 transformer**,40-100+ tok/s)
- 不要点"Recommended"的 Qwen3.5 9B / 4B / 2B

### 2. ⛔ llama-server 默认 ctx-size 会爆显存

**症状**:llama-server 启动"成功"(日志显示 `backend: cuda`),但模型加载超过 10 分钟不响应,或推理速度是 CPU 级别。

**原因**:Qwen3.5 的模型默认 context = **262144**(256K!)。llama-server 不传 `--ctx-size` 时按默认值分配 KV cache,光这一项就要 **11.9GB**。12GB 的 3060 在 fit 之后剩不下几百 MB,开始在 VRAM/RAM 之间 paging,推理被拖死。

**修复**:`src/helpers/llamaServer.js` 的 `baseArgs` 已经硬编码加了:
```js
"--ctx-size", String(options.ctxSize || 8192),
```
语音场景 8K 完全够。2060 上紧张可以降到 4K。

**怎么判断还没生效**:llama-server stderr 里搜 `context size reduced from 262144 to`——有这行就是默认值在作祟。

### 3. ⛔ llama.cpp 和 whisper.cpp 的 DLL ABI 冲突

**症状**:跑过 `npm run download:llama-server` 之后,whisper-server 启动时 `process died during startup`,或者 whisper 以前能 CUDA 现在只能 CPU。

**原因**:两个项目都发 `ggml.dll` / `ggml-base.dll` / `ggml-rpc.dll`,**同名但 ABI 不兼容**。默认下载脚本会把它们都放在 `resources/bin/`,Windows DLL 加载器按目录顺序找,先找到哪个用哪个,另一方挂掉。

**修复**:`scripts/download-llama-server.js` 已改成下载到 `resources/bin/llama/` 子目录隔离。`src/helpers/llamaServer.js` 的 `resolveBinary` 优先在子目录找。whisper 的 ggml DLL 留在 `resources/bin/`。

**手动清理(如果环境乱了)**:
```bash
# 期望状态:
ls resources/bin/       # 只有 whisper-server + sherpa + 对应 DLL
ls resources/bin/llama/ # llama-server + llama 的 ggml*.dll
```

### 4. ⛔ Whisper `ggml-large-v3-turbo` + CUDA 崩溃

**症状**:选 Turbo 模型,whisper-server 启动即退出(exit code 3221226505 = 栈溢出)。

**更恶心的**:崩一次之后,app 会把"CUDA 不可用"标记记到 session 里,**之后选任何 Whisper 模型都悄悄回落 CPU**,直到重启 app。

**修复**:
- **永远不选 Turbo**,除非打算 CPU-only
- 中文用 **medium**(最佳准确度 + GPU 加速)
- 小机器用 **small**

### 5. ⛔ Parakeet 不支持中文

**症状**:选 NVIDIA Parakeet TDT 0.6B v3 引擎,对中文说话返回空字符串。

**原因**:这个模型架构不覆盖中文。25 种语言里不含中文。

**修复**:中文场景只能 Whisper。Parakeet 留给英文。

### 6. ⛔ CUDA Whisper 需要手动装

**症状**:`npm run download:whisper-cpp` 默认下 CPU 版本,装完"GPU 加速"按钮点不亮。

**原因**:脚本里 win32-x64 的 zipName 写死是 `whisper-server-win32-x64-cpu.zip`。

**修复**:
1. 去 https://github.com/OpenWhispr/whisper.cpp/releases 找最新 release
2. 下 `whisper-server-win32-x64-cuda.zip`(~634MB)
3. 解压,把 `whisper-server-win32-x64-cuda.exe` 重命名成 `whisper-server-win32-x64.exe`,覆盖到 `resources/bin/`
4. 确保 `cudart64_12.dll` / `cublas64_12.dll` / `cublasLt64_12.dll` 也在 `resources/bin/`(zip 里自带)

建议做个备份:`cp whisper-server-win32-x64.exe whisper-server-win32-x64.exe.cpu.bak` 方便以后回退。

### 7. ⚠️ `npm run dev` 前要手动下二进制

**症状**:fresh clone 完跑 `npm run dev` 直接报 `whisper-server binary not found` 或 `Parakeet binary is missing`。

**原因**:`predev` 只下载 meeting-aec-helper、qdrant、embedding-model。whisper-cpp、sherpa-onnx、llama-server 只在 `prebuild*` 脚本里。

**修复**:`npm install` 之后、`npm run dev` 之前手动跑:
```bash
npm run download:whisper-cpp    # 或直接按第 6 条装 CUDA 版
npm run download:sherpa-onnx    # Parakeet 才需要(中文场景可跳)
npm run download:llama-server   # 本地 LLM 才需要
```

### 8. ⚠️ Node 24 锁死

**症状**:用 Node 22/26 跑 `npm install` 后 CI 跑 `npm ci` 会因 lockfile 兼容问题炸。

**原因**:`.nvmrc` 写 24,CI 也是 Node 24。npm 的 lockfile 在不同 Node 主版本之间不兼容。

**修复**:`winget install OpenJS.NodeJS.LTS` 装 Node 24,或用 nvm 切:`nvm use 24`。

## Flash Attention 要不要开?

llama.cpp / whisper.cpp 都支持 `-fa` / `--flash-attn`,能在 Ampere 上快 20-40%、省显存。

**当前没开**,因为:
1. 两台机器一台 Ampere 一台 Turing,硬编码不合适
2. 主要瓶颈已经靠选对模型 + ctx-size 解决
3. 想开的话在 `src/helpers/llamaServer.js` 的 `baseArgs` 加一行 `"--flash-attn",` 就行(同样方式加到 whisper-server 的启动参数)

**要加的话**:建议用环境变量控制,`process.env.XIAOZHI_FLASH_ATTN === "1"` 时加,办公室机就不设这个环境变量。

## 调试技巧

### 看 llama-server 真实初始化日志

app 里的 debug logger 只在 `OPENWHISPR_LOG_LEVEL=debug` 下才写文件。想看 llama-server stderr 最直接的办法:

```bash
# 杀掉 app 启动的那个
taskkill //F //IM llama-server-win32-x64-cuda.exe

# 手动拿一样的参数跑,看 stderr
cd E:/Project/Voice/resources/bin/llama
./llama-server-win32-x64-cuda.exe \
  --model "C:/Users/你/.cache/openwhispr/models/Qwen3-4B-Q4_K_M.gguf" \
  --host 127.0.0.1 --port 8250 --threads 4 --jinja \
  --ctx-size 8192 --n-gpu-layers 99 2>&1 | tee llama-debug.log
```

找几个关键行:
- `ggml_cuda_init: found N CUDA devices` — CUDA 真识别到
- `load_backend: loaded CUDA backend from ggml-cuda.dll` — 后端真加载了
- `llama_params_fit_impl: projected to use X MiB ... free device memory` — 看显存算得过来吗
- `llama_model_load_from_file_impl: using device CUDA0` — 模型真放 GPU 了

### 看 Pipeline 分段耗时

Electron dev 控制台的日志里搜 `Pipeline timing`:
```
transcriptionProcessingDurationMs: 567   ← STT 快慢
reasoningProcessingDurationMs:   2300   ← LLM 快慢
roundTripDurationMs:             2900   ← 总耗时
```
一眼看出是 STT 还是 LLM 拖后腿。

## 设置的落盘位置(双机同步用)

| 内容 | 位置 | 同步? |
|------|------|-------|
| 代码 | git | ✅ |
| 模型文件 | `C:\Users\<你>\.cache\openwhispr\` | ❌ 各自下载 |
| API Keys | `C:\Users\<你>\AppData\Roaming\OpenWhispr-development\.env` | ❌ 各自填 |
| UI 设置(hotkey/agent name/TTS) | localStorage(在 userData) | ❌ 各自配 |
| 本地数据库(历史记录) | `userData\transcriptions-dev.db` | ❌ |

换机器时:git pull + `npm install` + 按上面第 6 条装 CUDA whisper + 进 Settings 重填 API Key 即可。

## 更新这份文档的时候

踩到新坑就加到"踩过的坑"章节,按严重程度排序。模型性能数据实测过再写,别凭感觉。
