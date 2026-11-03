# Agent Note: 滚动条只在滚动或悬停时出现

Status: implemented

## Problem

两件事同时要满足：

1. 静止时滚动条**不该占视线**——玻璃外壳上一条常驻灰条很扎眼。
2. 但完全隐藏又不行，用户看不出「这里能滚动」。

纯 CSS 方案做不到第二点：滚动条伪元素 `::-webkit-scrollbar-thumb` 只认**滚动容器自身**的状态，`:hover` 写在祖先或通配符上匹配不可靠。实测 `.sidebar:hover::-webkit-scrollbar-thumb` 对里面的 `.joblist` 无效，而 `.joblist:hover::-webkit-scrollbar-thumb` 又要求把每一个滚动容器都列一遍选择器。

## Decision

用一个极小的运行时给滚动容器打标记，样式只认标记：

- `src/renderer/lib/scrollbars.ts` 在 `main.tsx` 里 `enableAutoHideScrollbars()` 启动一次。
- 捕获阶段监听 `scroll`（`scroll` 不冒泡，必须 capture），给**真正在滚动**的元素加 `data-scrolling`，停手 900ms 后摘掉。
- 监听 `pointerover`，沿 `composedPath()` 找最近的"可滚祖先"（`scrollHeight > clientHeight + 2` 且 `overflow-y` 为 `auto`/`scroll`），加 `data-scroll-hover`；`pointerout` 时清空。
- 输入框这类会自己长高的容器，`overflow` 在 `hidden`/`auto` 之间切换后指针没动也要重算——导出 `refreshScrollHover()`，由 `PromptDock` 在自动增高后调用。
- `data-scrolling` **never** 打在不可滚元素上：否则清空内容后会挂着一个永不消失的状态。

样式三档（`glass.css`）：

| 状态 | 滑块 |
| --- | --- |
| 静止 | `transparent` |
| `data-scroll-hover` | 文字色 16–20% |
| `data-scrolling` | 文字色 26% |

滚动条本身仍是 10px 命中区 + 3px 可见滑块，并显式 `cursor: default`——不加这句时，输入框的 `cursor: text` 会被滚动条继承，鼠标移到滑块上还是 I 形光标（用户报过）。

## Alternatives considered

- **纯 CSS `:hover`（含通配符 `*:hover::-webkit-scrollbar-thumb`）**：零 JS、最省事。实测在 Chromium 里匹配不到（滚动条伪元素解析时按容器自身算），hover 上去滑块不出现。
- **只按滚动活动显示（不做悬停）**：更接近 macOS 原生习惯。但用户明确要求"鼠标放上去要显示，否则别人不知道这里能滚动"。
- **每个滚动容器列一条 `:hover` 选择器**：实测可行但脆弱——容器散落在 `.joblist` / `.canvas` / `.picker-list` / `.model-picker__list` 等多处，新加一个滚动区域就会漏。
- **用 CSS `scrollbar-width: none` 彻底隐藏**：会**接管整个滚动条外观**，让项目里所有 `::-webkit-scrollbar` 定制失效（`shell.css` 里有用同样的注释警告过），因此禁止。
- **用 JS 重建一个自定义滚动条 DOM**：可控性最强，但要自己处理惯性、命中、键盘、边缘情况，收益不抵成本。

## Consequences

- 收益：任何滚动容器（包括以后新增的）都自动获得"静止隐藏 / 悬停提示 / 滚动加深"三态，不需要逐个登记；输入框长高后滑块即时出现，不用挪鼠标。
- 代价 1：多了一个全局事件监听与一处 React 之外的可变状态（`hovered` / `lastPointer`），排查问题时要想到它。
- 代价 2：`pointerover` 沿路径遍历 + `getComputedStyle` 判断可滚，指针快速移动时有一定开销（实测未见卡顿，但热点区域不宜再加逻辑）。
- 代价 3：`window.blur` 时要清空标记，否则窗口失焦后悬停态会残留。

## Testing

- CDP 采样三态：`getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor`，静止 `rgba(0,0,0,0)`、悬停 `…/0.2`、滚动 `…/0.26`，停手后回到透明。
- 输入框场景：指针停在 `.dock__input` 上不动，把内容灌到溢出，确认 `data-scroll-hover` 自动挂上（`refreshScrollHover` 生效）；清空后 `data-scrolling` 不残留。
- 光标：`getComputedStyle(ta, '::-webkit-scrollbar').cursor === 'default'`，而 textarea 本体仍是 `text`。
- `npm run smoke` 109 条断言（覆盖侧栏、结果区、下拉、弹窗的滚动容器存在性）。
