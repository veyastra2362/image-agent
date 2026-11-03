# Agent Note: 应用图标从生成图到 icon.png / icon.ico

Status: implemented

## Problem

应用图标最初是缺失的：`BrowserWindow` 没有 `icon`，任务栏和窗口左上角显示 Electron 默认图标。用户用本应用生成了一张方形图（黑底白色 N 形），要用它做图标。

生成图和图标之间有三段距离：图带白边、白色边角在深色任务栏上会变成"白方块"、Windows 还需要多尺寸 `.ico`。

## Decision

`scripts/make-icon.mjs`（`npm run icon <源图>`）一次做完三件事：

1. `sharp` 裁掉四周白边（`trim({ threshold: 8 })`）并缩放到 1024×1024；
2. **泛洪填充**把"从图像边缘连通过来的白色"抠成透明：从四条边开始 BFS，只吃连通的近白像素（r/g/b > 234），图标内部的白色字母不会被戳洞；
3. 生成 `resources/icon.png`（1024）与 `resources/icon.ico`（16/24/32/48/64/128/256，PNG 压缩条目手写 ICO 头）。

产物接入点：`main.ts` 的 `BrowserWindow({ icon: path.resolve(APP_ROOT, "resources", "icon.png") })`。
侧栏品牌头用同一张图（`import appIcon from "../../../resources/icon.png"`），深色主题下加 `filter: invert(1)`——原图是黑底白字，不反相在深色玻璃上会糊成一块。

## Alternatives considered

- **直接用生成的 1254×1254 原图**：最省事。但四周有白边、圆角外是白底，深色任务栏上会显示成一个白方块。
- **把所有近白像素都设成透明（不做连通判断）**：一行代码搞定。但图标中间的白色字母也是近白，会被一起抠掉，只剩黑底。
- **只做 `icon.png`，不做 `.ico`**：Windows 任务栏和资源管理器都能读 PNG。但快捷方式/打包时仍需要 `.ico`，早晚要补，不如一次生成。
- **引入 `png-to-ico` 之类依赖**：省掉手写 ICO 的二十行。但 ICO 只是"头部 + 目录项 + PNG 数据"，依赖能省下的复杂度小于多一个包的维护成本。
- **把图标放进 renderer 的 `public/`**：前端引用更方便。但窗口图标是主进程读的，`resources/` 才能同时被主进程和打包产物引用。

## Consequences

- 收益：窗口/任务栏图标就是应用自己生成的那张图；换图只需 `npm run icon <新图>` 一条命令，`icon.png` 与 `icon.ico` 一起更新。
- 代价 1：抠图依赖"边缘连通白色"这一假设。如果以后换成深色背景的图，这一步什么都不做（不会误伤），但也不会有额外收益。
- 代价 2：ICO 是自己拼的，只放 PNG 压缩条目——Windows Vista 以后都支持，但非常老的 XP 图标读取器不认，本项目不需要考虑。
- 代价 3：**桌面快捷方式图标还没做**。快捷方式图标来自 exe 资源，要打包（electron-builder 的 `build/icon.ico`）或手工造 `.lnk` 指向 `electron.exe` 并覆盖图标；目前只有窗口与任务栏生效。
- 代价 4：`resources/icon.png` 会被 git 跟踪（约 340KB），属于"生成产物入库"，换来的是开箱即用的图标。

## Testing

- `sharp` 读回 `resources/icon.png` 采样 alpha：四角 0、顶边中点 255、中心 255、字母内部 255——既证明边角被抠透，也证明字母没被打洞。
- 应用启动后确认 `BrowserWindow` 构造参数里 `icon` 指向存在的文件（启动日志无 ENOENT），窗口左上角显示新图标。
- `npm run icon` 可重复执行，产物文件名稳定，diff 只在二进制层面变化。
