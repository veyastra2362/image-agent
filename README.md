# Image Agent

本地优先的自然语言生图桌面应用。产品目标、切片划分与验收标准见 [IMAGE_AGENT_ROADMAP.md](./IMAGE_AGENT_ROADMAP.md)。

**当前进度：多服务商 + 作品持久化 + 数据备份。** 配置与密钥全部由应用自己管理（不再读 `.env`）；
任务、图片、配置都落盘，重启仍在；设置里可以导出/导入/清除数据。

## 快速开始

```bash
npm install
npm run dev        # 开发模式：main 自己拉起 Vite，renderer 带 HMR
npm run build      # 构建 out/main + out/renderer
npm start          # 运行构建产物
npm run typecheck  # 两套 tsconfig 都检查
npm test           # node:test，离线、不花钱、不需要 key
npm run smoke      # Electron 端到端冒烟 + 截图到 .artifacts/ui（强制离线）
```

## 接入真实图片服务

在应用里 **设置 → API 设置** 填写，改完立即生效（不需要重启）：

1. 服务商类型、API URL、API Key。
2. 点「获取上游模型」拉 `GET {base}/models`，勾选要启用的模型（也可手动填 ID）。
3. 保存后创作页的模型列表就会更新。

密钥只由 main 保存与使用：有系统钥匙串时用 Electron `safeStorage` 加密，
renderer 拿到的只有「有没有密钥 / 是否加密」这种状态，没有任何密钥字段。

当前适配器按通行的 OpenAI 图片接口实现：`POST {baseUrl}/images/generations`，
请求体 `{ model, prompt, n, size }`，响应接受 `data[].b64_json` 或 `data[].url`，内容必须是 PNG。

尺寸：实测（2026-10-29）该网关**不限尺寸**——`1792x1024`、`1024x1792`、`2048x2048` 都原样返回，
不传 `size` 时由上游决定（返回过 1254×1254）。因此自动尺寸、自定义宽高、常用比例全部开放。

参考图：带参考图时改走 `POST {baseUrl}/images/edits`（multipart）。
一张用字段 `image`，多张用 `image[]`。已实测：单张（768×768 → 1024×1024）与
两张（合并成一张）都成功。界面最多 4 张，可点「参考图」上传、Ctrl+V 粘贴，
或从作品库下拉里添加；缩略图显示在输入框上方，侧栏悬停 1.5 秒会浮出大图预览。

## 数据与备份

| 数据 | 位置 |
| --- | --- |
| 服务商配置与（加密的）密钥 | `%APPDATA%/Image Agent/provider-settings.json` |
| 任务与作品索引 | `%APPDATA%/Image Agent/library.json` |
| 图片文件 | 默认 `图片/Image Agent/assets`，可在 **设置 → 存储** 改 |
| 作品库设置 | `%APPDATA%/Image Agent/library-settings.json` |

**设置 → 数据管理** 可以：

- 导出：打包成 ZIP，可选是否包含配置、是否包含任务和图片（配置里含 API Key 明文，注意保管）。
- 导入：从本应用导出的 ZIP 恢复，只恢复「已勾选且备份里有」的部分，同名项覆盖。
- 清除：删除所选数据，不可撤销（二次确认）。

## 结构

```
src/main/            Electron 主进程
  main.ts            窗口、单实例、导航拦截、开发/生产加载
  ipc.ts             image:* IPC 注册与发送者校验
  preload.ts         contextBridge 暴露 window.imageAgent（自包含，不 require 项目模块）
  provider-settings-store.ts  多服务商配置 + 加密密钥
  library-store.ts   作品落盘（索引在 userData，图片在用户目录）
  data-manager.ts    导出/导入/清除
  image-generation/  任务服务、provider 契约、假 provider
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
out/main/*.js             其余根级模块，以及 image-generation/
out/main/package.json     {"type":"commonjs"}，因为根 package.json 是 ESM
out/renderer/             Vite 产物
```

源码里对共享代码统一写 `@shared/*`，tsc 编译后由 `prepare-dist.mjs --after-tsc` 按文件在
`out/main` 中的位置改写成真实相对路径；两套 tsconfig 用 `paths` 提供编译期解析。

## 安全边界

- renderer 开启 `contextIsolation` + `sandbox`，关闭 `nodeIntegration`；只通过 preload 暴露具名方法，
  不暴露 `ipcRenderer`、channel 名或通用 invoke。
- main 对每个 IPC 调用校验发送者是本窗口顶层 frame，并对入参做完整校验。
- 密钥不经过 renderer；作品图片通过 `ia-asset://` 协议按 assetId 读取，不暴露磁盘路径。
- 文本输入框与标题栏的交互控件都标了 `-webkit-app-region: no-drag`，不会被窗口拖拽吃掉点击。
- CSP 为 `default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob: ia-asset:`；
  页面跳转、重定向与 `window.open` 全部拦截。
## 提交与推送

- 每完成一块**有意义的改动**就提交，并在提交后**立即 `git push`**（`origin/main`），不必每次再问。
- 提交前跑一遍 `npm run typecheck`、`npm test`、`npm run smoke`；三项全绿才提交。
- 提交信息写清"改了什么、为什么"，不写"update"这类无信息量的内容。

## 已知限制

- 流式（Responses API SSE）与 fal.ai adapter 尚未接入，设置项已保存但请求仍走非流式 images 接口。
- 提示词 Agent 改写已接通（`/chat/completions`，语言模型配置独立），但要求服务商提供 chat 模型。
- 同步假模型（Fake Sync 1）只在端到端冒烟里注册，正式运行不出现；异步假模型可取消。
- 备份口令加密是可选项；不设口令时 ZIP 内的 API Key 是明文。
- 没有安装包（打包在后续切片）。