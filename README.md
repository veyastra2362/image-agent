# Image Agent

本地优先的自然语言生图桌面应用。产品目标、切片划分与验收标准见 [IMAGE_AGENT_ROADMAP.md](./IMAGE_AGENT_ROADMAP.md)。

**当前进度：S2（真实 provider 适配器 + 密钥只存在于 main）。** 已接一个 OpenAI 兼容的图片接口，
但只有你自己在本地 `.env` 里配好密钥时才会出现；任务与作品仍然只存在内存里，重启即清空。

## 快速开始

```bash
npm install
cp .env.example .env   # 可选：填 IMAGE_AGENT_API_KEY / IMAGE_AGENT_BASE_URL
npm run dev        # 开发模式：main 自己拉起 Vite，renderer 带 HMR
npm run build      # 构建 out/main + out/renderer
npm start          # 运行构建产物
npm run typecheck  # 两套 tsconfig 都检查
npm test           # node:test，离线、不花钱、不需要 key
npm run smoke      # Electron 端到端冒烟 + 截图到 .artifacts/ui（强制离线）
```

## 接入真实图片服务

1. `cp .env.example .env`，填 `IMAGE_AGENT_API_KEY` 和 `IMAGE_AGENT_BASE_URL`（可选 `IMAGE_AGENT_MODEL`）。
2. 重启应用。配置齐全时界面里会多出真实模型，并默认选中；没配置就只剩离线假服务。
3. 密钥只被 main 读取：`.env` 在 `.gitignore` 里；renderer 拿到的只有模型名与能力，没有任何密钥字段。

临时关闭真实服务（例如跑离线验证）不用改文件，把环境变量显式置空即可：

```bash
IMAGE_AGENT_API_KEY= IMAGE_AGENT_BASE_URL= npm run dev
```

当前适配器按通行的 OpenAI 图片接口实现：`POST {baseUrl}/images/generations`，
请求体 `{ model, prompt, n, size }`，响应接受 `data[].b64_json` 或 `data[].url`，内容必须是 PNG。
协议里没有 seed / 负面提示词 / 取消的通用定义，所以这些能力一律声明为不支持，界面会隐藏对应控件。

## 结构

```
src/main/            Electron 主进程
  main.ts            窗口、单实例、导航拦截、开发/生产加载
  ipc.ts             image:* IPC 注册与发送者校验
  preload.ts         contextBridge 暴露 window.imageAgent（自包含，不 require 项目模块）
  dev-server.ts      开发模式下用 ELECTRON_RUN_AS_NODE 启动 Vite
  image-generation/  任务服务、内存存储、provider 契约、假 provider
src/shared/          主进程与界面共用的类型、校验、channel 常量
src/renderer/        React 界面
src/test/            node:test 单元/契约测试
fixtures/            假 provider 返回的测试图片
scripts/             构建、tsc 启动器、测试钩子、冒烟驱动
```

## 构建产物布局

`out/` 的布局与源码不同，由 `scripts/prepare-dist.mjs` 决定：

```
out/main/main.js          主进程（package.json "main"）
out/main/preload.js       preload
out/main/shared/*.js      共享模块（preload 与 main 同级引用）
out/main/ipc.js、dev-server*.js、image-generation/
out/main/package.json     {"type":"commonjs"}，因为根 package.json 是 ESM
out/renderer/             Vite 产物
```

源码里对共享代码统一写 `@shared/*`，tsc 编译后由 `prepare-dist.mjs --after-tsc` 按文件在
`out/main` 中的位置改写成真实相对路径；两套 tsconfig 用 `paths` 提供编译期解析。

## 安全边界（S1 已实现）

- renderer 开启 `contextIsolation` + `sandbox`，关闭 `nodeIntegration`；只通过 preload 暴露
  5 个具名方法，不暴露 `ipcRenderer`、channel 名或通用 invoke。
- main 对每个 IPC 调用校验发送者是本窗口顶层 frame，并对入参做完整校验（未知字段、
  provider 能力、数量、比例、参考图、预算）。
- renderer 拿不到任何 API key；S1 里的假 provider 不联网、不读用户素材、`billable: false`。
- CSP 为 `default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:`；
  页面跳转、重定向与 `window.open` 全部拦截。

## 已知限制（S1 的事实，不是 bug）

- 任务与作品只存在内存里，重启即清空；界面上的“历史记忆”只是 localStorage 里缓存的预览图。
- 同步假模型（Fake Sync 1）在 main 里一次性完成，因此声明 `cancel: false`；异步假模型可取消。
- 预算上限只做会话内估算（假 provider 价格为空，显示“不产生费用”）。
- 没有安装包（打包在后续切片）。
