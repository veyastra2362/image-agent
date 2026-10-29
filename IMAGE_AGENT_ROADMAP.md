# 生图自动化 Agent：长期产品与技术路线图

**规划基线：2026-10-29**  
**产品形态：** 本地优先的 Electron 桌面应用；先服务个人创作者，再评估团队功能。  
**目标：** 用户用自然语言描述目标，Agent 协助整理需求、选择可用模型、生成和迭代图片，并把原图、参数和过程保存在本地。

> API、模型名、参数和服务条款都在变化。下面的厂商名单是分阶段接入目标，不代表每个上游模型都支持相同能力；每次发布应以厂商当前文档和实际账户权限复核。

## 1. 产品边界

首版要完整跑通一条创作链：**写需求 → 整理提示词 → 选择模型与参数 → 生成 → 查看/挑选 → 用自然语言继续编辑 → 保存和导出**。

首版不做云端账号系统、多人协作、模型训练、视频生成或自动发布。Agent 不应静默批量花钱：生成前显示模型、数量和可得时的费用估算；工作流可设单次预算，超限时要求用户确认。

“所有主流 API 都能接入”按两层交付：

1. 内置并维护明确列出的官方服务商适配器。
2. 提供通用 OpenAI Images 兼容配置，供 NewAPI 及其他兼容网关使用；另为协议差异明显的服务提供单独适配器。

兼容接口不能保证上游功能完全一致。应用需要显示每个模型实际支持的输入、编辑能力和参数，不能把一个服务的参数静默映射成另一个意思。

## 2. 独立项目约定

本产品是单独创建的桌面应用，拥有自己的源码仓库、应用身份、依赖、设置、密钥、作品库、发布包和版本计划。默认技术路线是 Electron + React + TypeScript + Vite；该选择只作为本项目的独立技术基线，不代表复用其他应用的代码或运行时。

- 项目根目录：D:\Code\image-agent。
- 安装包名、Electron appId、产品名、数据目录名和日志命名都使用本项目独立标识 image-agent。
- 使用自己的 Electron main/preload/renderer、IPC 类型和图片任务队列。
- 所有图片、数据库、provider 配置和加密密钥引用存入本应用自己的系统 userData 路径；不读取或迁移其他应用的会话、配置、凭据或作品。
- 初始代码树从本项目目录建立；不要从旁边的仓库复制 agent runtime、IPC、UI、数据库或 provider 实现。
- 可使用官方 SDK、HTTP 标准库和通用开源依赖；每个依赖需适配本项目 Electron 版本并检查许可证。

若实际仓库已有实现，以本项目当前文件为准；本节描述的是独立应用边界，不是要求照搬固定脚手架。

## 3. 产品体验与 GUI 方向

### 工作区结构

- **窄侧栏：** 创作、作品库、工作流、服务商设置。默认收起次要入口，避免把首屏做成控制台。
- **创作区：** 自然语言需求输入、提示词预览/编辑、参考图、模型、比例、输出数量和生成按钮。只展示当前模型支持的控件。
- **结果画布：** 生成中显示任务进度和取消入口；完成后网格看图，点击单张进入大图预览和迭代编辑。
- **详情抽屉：** 显示模型、原始提示词、Agent 改写、参数、时间、任务状态、成本（若服务可提供）和错误原文摘要。
- **全局任务栏：** 多任务排队、成功/失败、重试、打开结果位置。生成任务不应因切换页面或重启而消失。

### 视觉原则

- 简约、高级、安静：石墨或暖灰背景，少量强调色，清晰的字体层级，图片本身占据视觉中心。
- 使用细分隔、克制留白和统一控件；避免大面积渐变、无意义发光、每块内容都装卡片。
- 重要状态同时用文字和图形表达；焦点环、键盘操作、缩放和减少动态效果都纳入验收。
- 空库、无服务商、缺少密钥、排队、生成中、部分失败、限流、超时、编辑无参考图、窄窗口都设计真实状态。
- 初版窗口以桌面常见宽度优先；窄窗口时收起导航/详情，优先保留输入区和结果画布。

## 4. 架构决策

```text
React Renderer
    │ typed preload API（请求校验、事件订阅）
Electron Main
    ├── Agent / Workflow Orchestrator
    ├── Provider Registry + 独立 Provider Adapters
    ├── Durable Job Queue + Retry / Cancel / Poll
    ├── Local Library（元数据 + 图片文件）
    └── Secret Store（密钥不进入 Renderer）
           │
           ├── 官方图像 API
           ├── Replicate / fal 等模型托管平台
           └── NewAPI / OpenAI-compatible 自定义网关
```

### 共享任务格式

共享层只抽象真实共性：提示词、可选参考图、模型标识、数量、尺寸/比例、可选 seed、任务 ID/状态、结果文件、错误与原始 provider metadata。编辑、mask、负面提示词、参考图数量、流式输出等使用能力描述和 provider 原生参数；不支持的值明确禁用或报错。

每个 Provider Adapter 至少负责：凭据/连接检查、模型配置或模型列表（API 支持时）、能力描述、创建生成/编辑任务、查询异步状态、取消（API 支持时）、结果下载和错误归一化。调试详情保留脱敏后的原始请求/响应，避免丢失厂商特有信息。

### 本地数据与密钥

- 用本地数据库保存提供商配置引用、任务状态、提示词版本、图片元数据和编辑血缘；原图按文件保存，数据库记录相对路径和校验信息。
- API Key 存系统保护的加密存储，只让主进程读取；界面只显示掩码值，日志、错误提示和诊断导出均脱敏。
- 成功后尽快把图片复制到本地库，不能依赖短时效的远端 URL。Replicate 和 fal 文档说明结果文件/响应会过期，应把下载列为任务完成步骤。
- 删除作品时明确删除本地文件和记录；失败、取消和应用重启后可恢复任务状态，不能重复扣费式重试。
- 自定义 API Base URL 只接受 HTTPS；允许用户明确配置 loopback 本地服务。请求和重定向不得把密钥转发给不同主机。

## 5. 服务商覆盖路线

| 批次 | 服务/入口 | 接入方式 | 计划支持 |
|---|---|---|---|
| MVP | OpenAI Images | 官方适配器 | 文生图、图像编辑、尺寸/质量等当前模型参数 |
| MVP | Google Gemini 图像生成 | 官方适配器 | 对话式图像生成/编辑、比例与尺寸；随官方模型变化 |
| MVP | NewAPI | OpenAI Images 兼容适配器 + 可编辑 Base URL | `/v1/images/generations`、`/v1/images/edits`；安装方配置与上游能力决定实际支持范围 |
| 第一批扩展 | Black Forest Labs FLUX | 官方适配器 | 文生图、图像编辑及模型特有参数 |
| 第一批扩展 | Stability AI | 官方适配器 | Stable Image 的生成、编辑和可用增强能力 |
| 第一批扩展 | fal、Replicate | 各自平台适配器 | 异步任务、结果轮询/回调模式、模型 ID 和动态输入参数 |
| 第二批 | 阿里云百炼 Qwen-Image / Wan | DashScope/OpenAI-compatible 两条路按验证结果选择 | 文生图、图生图、提示词改写等官方提供的能力 |
| 第二批 | 火山引擎 Seedream | 官方适配器 | 文生图、参考图、批量图像/流式能力（按具体模型开放情况） |
| 第二批 | 腾讯混元生图 | 官方适配器 | 文生图、编辑及异步任务查询 |
| 持续评估 | 其他官方图像 API、企业网关和本地服务 | 兼容协议或独立适配器 | 进入适配器认证流程后排期，不承诺未经验证的“通吃” |

Midjourney 不进入首发接入承诺：其现行官方社区规则明确说明通常不提供 API，并禁止未经授权的服务自动化。后续只有取得官方授权或官方接口开放后再评估。

## 6. 分阶段计划与交付门槛

工期按 1–2 名工程师估算，按阶段验收，不把所有服务商并行开发。账户审批、模型额度、地区开放情况和上游改版可能改变日历时间。

### 阶段 0：需求收敛与 API 验证（1–2 周）

1. 明确主要用户和首发 OS；暂按个人创作者、Windows 桌面优先规划，后续保留 macOS/Linux 发布路径。
2. 写 3 个端到端用户故事：纯文本生成、参考图编辑、同一提示词多模型比较；确定首版不含视频和团队协作。
3. 用真实账号 spike OpenAI、Gemini、NewAPI 中至少各一次生成；另对 fal/Replicate 验证一个异步任务。记录真实模型、错误、返回图片格式、超时、费用获取方式和地区限制。
4. 建服务商能力矩阵：text-to-image、image-to-image、mask、数量、比例/尺寸、seed、同步/异步、取消、成本字段、结果 URL 有效期。
5. 用 2–3 个界面线框确认创作、结果、密钥配置三条主流程；确认深色/浅色首发策略。

**退出条件：** 至少一个官方直连和 NewAPI 网关真实生成成功；异步任务从提交到本地保存跑通；协议差异和 v1 接入清单已确认。

### 阶段 1：桌面端基础与可靠任务（2–3 周）

1. 建立独立 Electron + React + TypeScript + Vite 脚手架、产品身份和应用入口；再实现图像域模块、shared 类型和窄 preload API。
2. 做服务商设置：新增/编辑/测试连接、密钥掩码、Base URL 校验、默认模型；主进程保存密钥。
3. 建本地作品库元数据和图片落盘路径；执行数据库迁移和文件写入失败恢复策略。
4. 实现可持久化任务生命周期：queued、submitting、running、succeeded、failed、cancelled；支持轮询、取消、有限重试和重启恢复。
5. 统一错误类别：认证失败、额度/限流、参数不支持、超时、网络错误、内容策略拒绝；详情可看脱敏上游信息。
6. 添加任务日志和单请求预算上限；默认并发保守，用户能清楚看到尚未完成的费用风险。

**退出条件：** 关闭并重开应用后，任务和图片历史仍正确；一次网络中断不会丢结果或重复提交；密钥不出现在 Renderer 和日志。

### 阶段 2：MVP 创作 GUI（2–3 周）

1. 完成创作工作区、作品库、服务商设置三个主要视图，建立本项目自己的 CSS 语义变量体系，先确定间距、字体、对比度和控件状态。
2. 完成文本提示词、模型、比例/尺寸、数量和生成按钮；模型切换后只展示对应能力。
3. 展示任务进度、错误和重试；多图网格可放大查看、收藏、复制提示词、导出和打开文件位置。
4. 支持拖入参考图并预览；只对支持图生图/编辑的模型开启对应操作。
5. 建立图片 lineage：生成图、编辑图、父图、使用的提示词和模型之间可追溯；编辑输出永不覆盖原图。
6. 完成空态、加载、失败、部分成功、窄窗口、键盘导航和长提示词状态检查。

**退出条件：** 新用户在未配置时能理解下一步；配置一项服务后能从输入到本地导出完成完整创作；失败可恢复且原图保留。

### 阶段 3：Agent 协助与自动化（2–4 周）

1. Agent 接收自然语言 brief，并整理出可编辑的结构化创作计划：主题、用途、主体、风格、构图、比例、输出数量和限制。
2. 信息缺失时最多询问少量关键问题；可一键直接生成，提示词改写始终能预览、编辑或关闭。
3. 根据用户选择与能力矩阵推荐模型，展示推荐理由、预计耗时和可得的费用；用户确认后才提交任务。
4. 提供“基于这张图继续改”对话，保留当前版本和每次改动指令，支持回到任意历史版本。
5. 实现最小工作流模板：产品图变体、社媒多比例、角色/视觉风格探索。每一步可暂停、编辑和重跑，不先做任意脚本执行器。
6. 生成前做预算和数量检查；超过预算、跨服务商上传用户图片或增加批次时明确要求确认。
7. 记录 Agent 的计划、提示词和调用的 provider/model，便于复现和排查。

**退出条件：** 用户可审阅并修改计划；无用户确认不会启动高成本批次；改图链可追溯且回滚不丢版本。

### 阶段 4：主流 API 扩展与兼容性（3–5 周，分批滚动）

1. 第二个官方适配器后，稳定通用任务格式和能力描述；任何只对单一厂商成立的参数仍留在 provider 原生参数区。
2. 先完成 BFL 和 Stability，再完成 fal/Replicate；每个接入都验证异步状态、限流、结果文件下载、超时和错误映射。
3. 实现 NewAPI 预设：Base URL、API Key、模型名、图像接口模式；分别探测生成和编辑是否可用，不根据 `/v1` 地址猜测上游支持情况。
4. 允许用户加任意 OpenAI Images 兼容地址，并配置模型名/可选路径。兼容性探测给出结果，不静默降级到文本聊天接口。
5. 接入阿里、火山、腾讯等地区性服务商；每个按区域、异步协议、图像输入格式、授权方式和结果保留政策做适配。
6. 建立发布前适配器认证清单：成功生成、编辑（若支持）、无效 key、限流、上游 5xx、超时/取消、格式错误、结果 URL 过期和重启恢复。

**退出条件：** 内置适配器与兼容网关使用同一作品库和任务 UI；差异能力可见；新增服务商不要求改 Renderer 主流程。

### 阶段 5：工作流、批次与日常效率（2–4 周）

1. 同提示词跨模型并排比较；明确显示每张图的 provider、模型、参数和费用。
2. 变量模板和批量组合；批次可设张数、并发和花费上限，中途可暂停。
3. 作品库筛选：项目/日期/模型/收藏/提示词；支持标签和集合，先不做多人共享。
4. 导出原图、元数据和创作记录；支持批量导出，默认不覆盖已存在文件。
5. 对常用提示词、参数组合和流程做本地模板；模板升级不改写已有作品记录。
6. 观察运行数据（纯本地）：成功率、平均耗时、失败类别和用户取消率，用来排优先级，不默认上传使用遥测。

**退出条件：** 一次批次失败不阻断其他结果；批量任务可预算控制、暂停和恢复；导出后可以复现每张图的来源信息。

### 阶段 6：发布、安全与长期扩展（首发后持续）

1. 完成 Windows 安装包、升级/降级策略、备份恢复、卸载保留选项和离线作品库迁移；再根据用户需求发布 macOS/Linux。
2. 审查 Electron IPC sender、输入校验、外部链接、文件导入、图片尺寸/解码、API URL、重定向和日志脱敏；保持 renderer sandbox 与 context isolation。
3. 明确图片处理隐私：图片发送到哪个服务商、保存位置、上游数据保留说明；为密钥、任务记录和图片提供单独删除入口。
4. 建适配器开发约定和版本兼容层；第三方扩展先只允许声明式 provider adapter，不允许运行任意脚本。
5. 评估 ComfyUI/自托管推理、可选云端同步、团队共享、协作审批和视频生成；分别立项，不挤入首版承诺。
6. 每季度复核 API 端点、模型目录、定价、服务条款、SDK/Electron 安全更新和停止服务公告。

**长期门槛：** 任何新增能力都能单独关闭、回滚或迁移；新 API 不破坏历史作品元数据；服务商停服时作品库仍可访问和导出。

## 7. 核心验收指标

- **成功率：** 已配置服务商、有效参数下的任务成功率；区分上游策略拒绝和应用故障。
- **持久性：** 已完成结果本地保存率、重启后任务恢复率、图片元数据缺失率。
- **清晰度：** 用户能否辨认当前供应商、模型、参数、预计费用和 Agent 改写内容。
- **效率：** 从输入到第一张可预览图片的时间；提示词修改后迭代成功率。
- **成本控制：** 单批次预算超限次数、重复提交次数、用户取消成本。
- **兼容性：** 按服务商/模型/地区记录适配认证结果和最近验证版本。

## 8. 主要风险与处理

| 风险 | 处理方式 |
|---|---|
| API 和模型迭代快 | 模型名和能力配置不写死在 UI；每个版本记录适配器验证时间，变更后先跑认证清单 |
| OpenAI-compatible 并不代表图像能力一致 | 配置时分别探测 generate/edit；保留原始错误；不支持的参数不发送 |
| 异步结果 URL 过期 | 任务完成后立即下载至本地；下载失败保留任务并提供重试 |
| 自动化引起意外费用 | 单次预算、批量预算、明确确认点、重复提交保护 |
| 密钥或图片泄露 | 主进程持钥、系统保护存储、脱敏日志、限制跨主机重定向、图片不默认上传同步服务 |
| 多服务商参数无法完全统一 | 统一用户高频共性参数；原生参数可见保留；能力不足时解释并禁止提交 |
| Midjourney API 不可用/禁止非授权自动化 | 不做网页或 Discord 仿真自动化；等待官方接口或授权 |

## 9. 需要持续跟踪的官方资料

- [OpenAI Images API 指南](https://developers.openai.com/api/docs/guides/images-vision)
- [Google Gemini 图像生成文档](https://ai.google.dev/gemini-api/docs/image-generation)
- [Black Forest Labs 文档](https://docs.bfl.ml/)
- [Stability AI API 文档与变更记录](https://platform.stability.ai/docs/release-notes)
- [Replicate Predictions](https://replicate.com/docs/topics/predictions/create-a-prediction) · [fal Queue API](https://fal.ai/docs/api-reference/inference-api/queue/submit)
- [NewAPI API 文档](https://github.com/QuantumNous/new-api) · [NewAPI 图像接口说明](https://github.com/QuantumNous/new-api-docs-v1/blob/main/content/docs/en/guide/feature-guide/user/api.mdx)
- [阿里云百炼图像生成与编辑](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference) · [火山引擎 Seedream](https://docs.volcengine.com/docs/lake-ai-service/image-generation-and-editing-doubao-seed-ream-series-models?lang=en) · [腾讯混元图像 API](https://cloud.tencent.com/document/product/1668/88077)
- [Midjourney 官方社区规则](https://docs.midjourney.com/hc/en-us/articles/32013696484109-Community-Guidelines)
- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security) · [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

## 10. 给实施 AI 的执行约定

本节是执行规范。把本文件交给代码 AI 时，要求它**一次只做一个切片**，完成后交付结果并等待下一条切片指令；不要把整份路线图一次性实现。若当前代码和本文件描述不一致，先报告差异并提出最小修正，不要重写现有架构。

### 新项目事实与边界

- 所有命令、代码和数据只在 D:\Code\image-agent 内操作；先读该目录的 AGENTS.md（若存在）、路线图、README、package manifest 和 git status。
- 当前目录若只有计划文档，则按空项目处理：S0 只做调查与 spike，S1 建立独立脚手架；不要在其他项目中寻找或复制实现。
- 推荐初始结构见下方“建议代码落点”。文件名按实际工具链调整，但 main、preload、renderer、provider adapter、持久化模块保持分层。
- 默认沿用 Chromium/Electron 安全边界：renderer sandbox、context isolation、nodeIntegration false；IPC 参数在 main 校验，不能暴露任意 IPC 通道。
- 使用 Electron 内置的 node:test 验证 shared/main 纯逻辑和 stub HTTP；UI 用打包/开发运行截图和手工检查。默认验证不得依赖真实 Key、产生费用或访问公共图像服务。
- 真实服务商调用、测试图片数量、可产生的费用和超时应由用户明确授权；不要向用户索取聊天消息中的 API Key。
- 不把 API Key 写进 .env、源码、项目目录、日志、截图、测试快照或报错；不把生成图片保存到仓库根目录。

### 独立应用规则

实施目标是一个新的 Image Agent 桌面应用，不是其他产品的插件、模式、扩展页面或 SDK 前端。不得添加到其他应用的菜单，不得导入其他应用的 package、SDK、会话存储或 credential store。交付应能在 D:\Code\image-agent 单独安装依赖、开发运行、构建和打包。

### 建议的代码落点

这是有意保持小而清楚的初始文件边界。开始每个切片前仍要重新检查仓库，已有等价模块时复用，不为符合列表而重复造文件。

```text
src/shared/image-generation.ts          # IPC 边界上的请求、事件、任务和能力类型
src/shared/image-api.ts                 # Renderer 可调用的窄接口；不要把 ipcRenderer 暴露出去
src/shared/channels.ts                  # 新增 image:* channel 常量
src/main/image-generation/
  service.ts                            # 配置、任务和 provider 的协调入口
  provider.ts                           # 最小 provider 合约和能力类型（如未放 shared）
  openai-images.ts                      # OpenAI Images 官方 API
  openai-compatible-images.ts           # NewAPI 预设及用户自定义兼容网关
  gemini-images.ts                      # Google Gemini 官方 API，后续切片
  store.ts                              # 元数据、队列恢复和图片文件保存
  secrets.ts                            # 系统保护的密钥存取
src/main/main.ts                        # 创建服务并注册 image IPC，不承载厂商协议细节
src/main/preload.ts                     # contextBridge 只暴露 image API 的明确方法
src/renderer/image/                     # 图像创作页面、作品库和设置组件
src/test/image-*.test.ts                # 纯逻辑、存储和 stub HTTP 测试
```

可在执行时合并过细的小文件，但要保留三条边界：**renderer 只调用类型化 IPC；服务编排和 API Key 在 main；每个厂商的请求/响应格式留在对应 adapter**。

### 第一版共享类型约定

以下为协议设计检查表，不要求逐字照抄；AI 应先提出一个最小、可编译的类型，再用调用方验证有没有不必要字段。

```ts
type JobStatus =
  | "queued" | "submitting" | "running"
  | "succeeded" | "failed" | "cancelled";

interface ImageCapabilities {
  textToImage: boolean;
  imageToImage: boolean;
  masks: boolean;
  referenceImageLimit?: number;
  aspectRatios?: readonly string[];
  sizes?: readonly string[];
  outputCountLimit?: number;
  seed: boolean;
  negativePrompt: boolean;
  async: boolean;
  cancel: boolean;
}

interface ImageJob {
  id: string; providerId: string; model: string; status: JobStatus;
  prompt: string; createdAt: number; updatedAt: number;
  remoteTaskId?: string; assetIds: string[];
  error?: { code: string; message: string; retryable: boolean };
}
```

最低限度需要：

1. 使用 `unknown` 接收跨 IPC 和网络 JSON，再在 main 边界校验；renderer 发送来的 model、数量、图片路径和参数都不可信。
2. 任务和作品用稳定 ID；标题、提示词和文件名不可充当唯一键。
3. 在任务/作品记录里保存实际提交的模型名、原始 prompt、Agent prompt（若有）、能力快照、用户参数、时间戳和脱敏后的 provider 元信息。
4. 同一套 UI 只显示 `ImageCapabilities` 声明支持的参数；`nativeOptions` 若需要，按 provider 分区存储并在提交前 schema/白名单校验，不能接收任意对象后直接转发。
5. `succeeded` 只有在结果已成功下载到本地并创建作品记录后才能发出；下载失败应可单独重试，不能丢远端任务 ID。
6. 对于“请求超时但服务端可能已接收”的提交结果，标记为需要对账/未知状态；不要自动重新 POST 生成请求。仅在明确安全的错误或上游支持幂等键时重试提交。

Provider 最小运行约定：

- `getCapabilities(config, model)` 给出模型级能力；不能只有 provider 级能力。
- `submit(config, request, signal)` 返回 `completed`（已有可下载结果）或 `running`（包含 remote task ID 和下次查询建议）。
- `poll(config, remoteTaskId, signal)` 将上游状态转换成运行中、成功、失败或取消；每个 adapter 自己处理上游状态名。
- `cancel` 只有上游真的支持时才实现，UI 不支持时显示真实状态，不能假装已停止。
- 每个网络调用有 AbortSignal/超时、响应大小限制、内容类型校验和脱敏错误。图片下载只允许 HTTP(S) 结果地址；拒绝 file/data/未知协议。

## 11. 可直接排期的 AI 施工切片

每项都是一个独立 PR/提交的建议大小。先做上一个切片并达到退出条件，再开始下一个。每个切片都要把改动限制在目标文件和必要调用链内。

### S0 — 仓库与存储/API spike（只读为主，1–2 天）

**目标：** 在生产代码之前，回答数据存储、密钥存储和 API 协议三个高风险问题。

1. 确认 D:\Code\image-agent 是独立项目根，读取其中的 AGENTS.md、git 状态和已有文件。若尚无脚手架，记录为 S1 工作；不能把父目录或旁边项目当作本项目源码。
2. 查 Electron 当前版本的 `safeStorage` 行为，确认 Windows 与目标系统的后端、未解锁/不可用状态，以及不安全后端检测方式。若系统保护不可用，明确拒绝保存密钥或提供明确的会话期临时凭据方案，不静默明文落盘。
3. 在本机 Electron runtime 做一次 SQLite 能力 spike。若内建模块在当前 runtime 不成熟或打包后不可用，再比较一个依赖；报告迁移、备份、原生模块重建成本。先不选 ORM。
4. 对照官方最新文档，用一个 API Key 在临时验证脚本或外部小程序完成 OpenAI、Google、NewAPI 各一次最小请求；对 fal 或 Replicate 完成一次异步 submit/poll/download。脚本不得写入正式源码或密钥文件。
5. 验证 NewAPI 兼容 URL、生成/编辑路由、可用模型列表行为、上游返回格式和是否支持编辑；不要假设 `/v1/models` 完整列出图像模型。
6. 输出 `docs/image-agent-spike.md`：runtime 事实、存储决定、提供商矩阵、真实请求样例（密钥和私人 URL 全部脱敏）、未解决问题、推荐首发适配顺序。

**验收：** 文档有依据和复现步骤；至少一次图像结果成功下载；无真实 key 留在工作区或 shell history。若没有 API Key，明确标出哪些验证被阻塞，继续完成不需要账号的本地 spike，不伪称验证通过。

### S1 — 独立应用脚手架、IPC 类型与假 provider（2–4 天）

**目标：** 从空目录建立可独立开发、构建和启动的桌面应用骨架，并接通一条类型安全、可测试的图像任务通道；不调用真实 API。

1. 建立本项目自己的 package.json、锁文件、Electron main/preload/renderer 入口、Vite/TypeScript 配置、开发/构建/typecheck/test 脚本。设置独立产品名 image-agent、唯一 Electron appId 和应用图标占位，不引用其他应用的 package、build config 或窗口入口。
2. 创建图像任务、能力、provider 配置和 renderer API 类型；为状态转移和边界数据定义最小验证。
3. 新增 image channels；preload 只暴露 window.imageAgent 的明确方法和可取消事件订阅，不暴露通用 invoke(channel, ...args)。
4. main process 拒绝不合法长度的 prompt、未知 provider、数量越界、未知本地 assetId 和伪造 URL；renderer 的校验只改善体验，不作为安全边界。
5. 实现 fake provider，只返回固定的测试图片或本地 fixture，不在默认测试里调用网络。
6. 给任务状态 reducer/mapper 写 node:test：正常成功、失败、取消、未知状态和重复事件。

**目标文件：** package.json、Vite/TypeScript 配置、src/shared/image-generation.ts、src/shared/image-api.ts、src/shared/channels.ts、src/main/main.ts、src/main/preload.ts、最少量 src/main/image-generation/*、src/renderer/App.tsx、src/test/image-*.test.ts。

**验收：** npm run typecheck、npm run build、npm test 通过；安装、开发运行和构建只依赖 D:\Code\image-agent；应用 renderer 不能导入 Node/Electron；fake provider 可完成无网络生成流程；应用不读取其他应用的配置、密钥或用户数据。

### S2 — 本地秘密与 provider 配置（2–3 天）

**目标：** 可安全新增、编辑、移除 provider 配置。

1. 配置记录保存 provider ID、用户别名、Base URL、protocol、默认模型、能力覆盖（仅必要时）和 secret 引用；Key 不放普通设置 JSON。
2. main 使用当前平台保护存储存取 secret。记录加密后仍需要当前 OS 用户保护的边界；卸载、切换账户、密钥后端不可用时行为要明确。
3. 配置表单显示掩码、只在用户点击修改时替换 secret；编辑其他字段不把空掩码写回 Key。
4. Base URL 解析、协议/端口、loopback/private host 策略、去除末尾斜杠和 API path 拼接必须有测试。HTTP 非本机端点必须有显式开关/警告；跨主机重定向不得携带凭据。
5. “测试连接”若无法在不产生费用的前提下验证图像端点，应改成“保存配置/测试模型列表（如支持）”；不能偷偷生成一张测试图。

**验收：** 无 Key 的测试覆盖保存/删除/读取；界面与日志不返回完整 Key；密钥后端不可用时明示失败且不降级为明文。

### S3 — OpenAI Images + NewAPI 兼容适配器（3–5 天）

**目标：** 首发接入一条官方直连和一条通用兼容路径，涵盖 NewAPI。

1. 先查当前 OpenAI Images 官方文档，不把过去的 DALL·E 参数、模型名或 endpoint 复制成当前实现。
2. 以配置形式区分官方 OpenAI 和 OpenAI-compatible；通用 adapter 接收用户配置的 Base URL、模型名、图像 endpoint 模式和 Key。
3. NewAPI 只是一个兼容预设（Base URL + 通常的 Images endpoints），不另造几乎一样的 SDK；生成和编辑分开显示支持状态。
4. 请求格式适配 JSON 与 multipart edit 上传；检查 MIME、大小、尺寸上限，使用流式/分块文件上传策略，避免把大型图像无边界 base64 进内存。
5. 将 base64、临时 URL 或 provider file URL 统一下载至应用作品库；响应错误保留 HTTP 状态和上游 request ID，脱敏后展示。
6. 使用本地 stub HTTP server 测正常生成、编辑、多图响应、错误 JSON、429、超时、无效图片 URL、重定向和超大响应；不要把 Key 录进 stub fixture。

**验收：** 所有网络用例可离线跑；NewAPI 不可用或部分兼容时能保存配置并准确显示能力缺失；不会因 submit 超时而自动重复计费式请求。

### S4 — 任务持久化与作品落盘（3–5 天）

**目标：** 生成任务跨页面与重启存活，原始文件不丢。

1. 定下 S0 选出的数据库/文件方案；数据库位于本应用独立的 Electron app.getPath(userData) 下，不在 repo cwd。
2. 最小表：`provider_profiles`（不含明文 Key）、`jobs`、`assets`、`job_events`（若恢复确实需要）。版本迁移按顺序可重复执行；不一次性设计云端 schema。
3. 图片文件使用 UUID 路径和 MIME 对应扩展名；限制总字节和单张尺寸，写入临时文件后原子 rename，再提交数据库记录。
4. 启动时扫描 queued/submitting/running 状态并恢复：能查询 remote ID 就 poll；状态不明则标记人工处理，不重新生成。
5. 删除 asset、父图和 job 的关系规则先明确；默认删数据库记录不应误删其他作品引用的文件。
6. 持久化测试覆盖损坏/截断图片、磁盘满/写入失败、迁移、重复事件、崩溃后临时文件、重复 asset、路径穿越。

**验收：** 删除/重新启动应用不会把图保存到工作区外任意路径；图像任务成功事件仅在文件和元数据都持久化后发出；同一图片不会被双重删除。

### S5 — 简约创作 GUI 与作品库（4–6 天）

**目标：** 没有 Agent 也能直接生成、浏览和导出图像。

1. 创建本应用自己的 App.tsx 和主导航，默认进入图像创作；先用真实空态确定导航，不先做自绘窗口框。
2. 建一张可运行的 1440×900 和 900×650 布局图：侧栏约 64px，参数栏约 320px，画布占剩余空间；小窗时折叠参数/详情。
3. 创作页提供 prompt、provider/model、参考图、比例/尺寸、数量、生成/停止；仅显示 capability 有效的选项。费用不可得时显示“上游未提供”，不得猜金额。
4. 任务队列与作品库展示排队/运行/部分成功/失败；可预览大图、复制 prompt、收藏、导出和打开保存位置。
5. 参考图选取由 Electron dialog 或安全的文件选取 API 完成；Renderer 只获得 asset ID/受控预览 URL，不传任意磁盘路径给 provider。
6. 运行截图和手工检查：空状态、密钥缺失、长 prompt、生成中、部分成功、API 错误、720px 窄窗、键盘焦点和减少动态效果。

**验收：** 用户可只配一个服务完成从输入到导出的全流程；页面无横向溢出，错误保留输入内容；停止只终止对应 job。

### S6 — Google Gemini 与主流 provider 适配器（按需每家 2–4 天）

**目标：** 按适配器认证清单扩展，不做一轮大爆炸式重构。

对每家服务重复以下流程：

1. 从该服务官方文档确认认证、端点、图像输入形式、同步/异步、返回 URL 时效、区域和内容限制。
2. 新增一个 provider adapter 和 adapter 单元测试；除共用能力类型外，不改作品库/Renderer UI。
3. 用能力表映射可用参数；不支持的编辑、mask、seed、数量等明确标 false/上限。
4. 错误码、限流退避、请求取消和图像保存使用本服务适配器映射；保留脱敏 request ID。
5. stub tests 后，使用真实账号手动 smoke test 一次生成/编辑（如需要并产生费用，先由用户配置并明确允许）；记录模型和验证日期。

接入顺序建议：Google Gemini → BFL → Stability → fal/Replicate → 阿里云百炼 → 火山 Seedream → 腾讯混元。接入顺序可根据目标用户所在地区和可用账户调整，不因表格中列出就声称已支持。

**验收：** 每家 adapter 合并前有能力矩阵、独立测试和一条真实验证记录；新增 provider 不需要在 App 页面增加 provider-specific 的条件分支。

### S7 — Agent Planner（3–5 天）

**目标：** 把自由文本变为可审阅的生图计划，不开放通用工具执行。

1. 配置一套单独的文本模型连接（可使用 NewAPI/OpenAI-compatible chat endpoint）；文本模型配置和图像模型配置分开显示。
2. Planner 输入只包含用户 brief、当前用户选定/可用的模型能力摘要及用户主动选中的参考图；默认不上传整个作品库或文件系统。
3. Planner 只返回经过 runtime 校验的 `ImagePlan` JSON：精炼目标、prompt、可选 negative prompt、比例/数量建议、推荐的已配置模型及理由、需澄清问题；schema 不合法时向用户显示可恢复错误，不执行任何动作。
4. UI 展示原始 brief 和 Agent 改写结果，用户能编辑、重置或关闭改写。图像 API 调用必须经用户确认按钮，不允许 planner 自行调用 provider。
5. cost provider 没有公开价格时不让模型编造费用；只有用户手设预算或有版本化价格表时才拦截预算。
6. Agent 断网/失败/超时应提供“手动继续生成”，不丢输入或强迫先修好 Planner。

Planner 只负责结构化图像需求，不具备任意文件访问、shell、代码编辑或通用工具调用能力。

**验收：** 非法/恶意 JSON 不触发 API；用户未确认不会花图像额度；Agent 不可访问本地文件；Planner 不可用仍可直连生成。

### S8 — 对话式编辑、批量与工作流（按用户数据决定）

1. 一轮编辑明确引用父 asset ID、编辑指令、选定模型和 reference inputs；新图创建新 asset，原图只读。
2. 跨模型比较和批次分开排 job，设并发上限和预算；部分失败不把成功结果回滚。
3. 工作流用 JSON 声明式步骤（prompt template、model、输入引用、用户确认节点），暂不执行用户脚本、插件代码或 shell。
4. 每个步骤暂停/继续/重跑；重跑显示可能再次产生费用，支持预算取消。
5. 流程版本和历史 asset 绑定固定快照，不因编辑模板影响已完成结果。

**验收：** 任一批次可暂停、重启恢复和局部重跑；结果 lineage 可查看；任何重复付费请求都有用户可见记录。

### S9 — 发布与维护

1. 将安装包放入独立、干净测试环境，验证安装、升级、回滚、卸载、数据保留和首次启动。
2. 验证没有 Key 时产品仍可浏览本地库；Key 存储后端不安全时显示明确阻止/降级选择。
3. 为每个 adapter 维护端点版本、支持模型、上次实测日期、测试来源和已知限制。
4. 设置上游 API 退役操作手册：标记停止服务、保留历史作品、隐藏不可用模型、提示替代项；禁止自动替换历史模型并重跑。
5. 发布前跑静态检查、构建、默认离线测试、打包后 UI 手工检查；真实 API smoke test 与费用说明单独记录。

## 12. 每个切片的 AI 输入模板

复制以下模板，并把 `<切片编号>`、`<明确范围>` 替换为一项切片。一次只给一项。

```text
你在 D:\Code\image-agent 工作。目标切片：<编号和标题>。本项目是独立的 Image Agent 桌面应用。

先读 IMAGE_AGENT_ROADMAP.md 的“给实施 AI 的执行约定”和对应切片，再检查当前文件、调用方和 git diff。不要假设路线图中的文件一定已创建。

本次目标：<只摘录该切片的目标与验收条件>。
范围：只改完成目标必需的文件。保持本项目的 Electron sandbox、context isolation 和窄 IPC 边界；不要导入其他应用的运行时、会话、凭据或代码。不要提前实现后续切片，不要添加无关依赖、泛化插件系统或扩大无关 UI 范围。
外部 API：实现前核对当前官方文档；不要使用网页抓取、未授权接口或过期模型示例。密钥只能由用户在应用里输入，不得要求用户把密钥发到聊天或写进源码。
成本：默认只跑离线测试和本地 stub。任何真实 API 调用都先明确列出可能费用、模型/数量/上限，并等用户明确授权。
交付：完成改动后执行本切片允许的检查，报告改动文件、用户可见行为、命令与结果、未覆盖项、风险和下一切片依赖。若前置验证失败，交付失败证据和最小选择，不自行扩大范围。
```

## 13. 全局完成定义（DoD）

任一实施切片只有同时满足以下条件才算完成：

- 从界面入口到 main/provider/store 的完整调用链已连通，或明确说明本切片只交付 mock/类型并写清下一切片如何接线。
- renderer 不持有密钥、不直接访问 provider、不具备 Node 权限；main 校验所有来自 IPC 的字段。
- 异常和取消有用户可见状态；已有图片和任务不会被覆盖或删除。
- 默认测试不要求真实 API Key、不产生费用、不调用公共图像接口。
- `npm run typecheck` 和 `npm run build` 通过；新增纯逻辑测试由 `npm test` 覆盖。需要 Electron UI 验收时提供截图/检查记录，不以 DOM 测试代替视觉检查。
- 最终报告明确写出“已验证”与“尚未验证”，不把 mock server 测试描述成真实 provider 可用。

## 14. 实施期间必须遵守的业务规则

1. **费用估算不能伪造。** API 不给价格时显示未知；成本上限只基于已验证价格或用户自己填写的限额。
2. **连接测试不应偷偷生图。** 若没有无成本认证端点，提示用户用一张真实图验证并标明费用，等用户确认再执行。
3. **原图不可变。** 所有编辑、重绘、放大都生成新版本，文件名冲突自动避让，不覆盖旧图。
4. **上传要可见。** 每次将参考图交给某 provider 前，UI 要显示将发送到哪家服务；私密 prompt/图片默认仅存在本地，云端 Planner 需单独设置。
5. **供应商错误不隐藏。** 翻译成用户可读提示的同时保留脱敏原始错误、HTTP 状态和 request ID。
6. **模型和能力按服务配置。** 不假设模型名列表统一，不把模型自动换成“看起来相似”的另一个模型。
7. **重试先区分阶段。** 下载结果的重试可安全重复；提交任务的重试可能重复计费，必须先判断幂等性或让用户确认。
