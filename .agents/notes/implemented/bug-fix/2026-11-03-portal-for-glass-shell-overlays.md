# Agent Note: 玻璃外壳下的弹窗与浮层必须挂到 body

Status: implemented

## Problem

界面改成「液体玻璃」外壳后（标题栏 / 侧栏 / 输入区都用 `backdrop-filter` + 半透明底），出现两类看得见但找不到原因的故障：

1. 画面设置弹窗被压成约 300px 宽，三张模式卡片挤成窄条、文字每两三个字一换行。
2. 任务行的右键菜单只露出一半，另一半被侧栏切掉。

两处都不是布局写错了，是 `backdrop-filter` 与 `overflow` 的副作用。

## Decision

凡是"浮在别的元素之上"的层（弹窗、右键菜单、下拉面板），必须渲染到 `document.body`，不能留在触发它的节点内部：

- 画面设置弹窗、遮罩编辑器：`createPortal(..., document.body)`（`ConfigSidebar.tsx`）。
- 任务行右键菜单：`createPortal(..., document.body)`，并按视口边界收敛坐标（`JobList.tsx`）。
- 自绘下拉菜单本来就带 `.select__menu--portal`，继续用 portal。

同时确立两条层叠规则：

- 弹窗本体 **must** 是 0.9 不透明度（`rgba(250,250,249,.9)` / `rgba(22,25,29,.9)`）+ `blur(30px)`；标题栏与底部按钮栏是**实色**（`#fafaf9` / `#16191d`），内容区透明。弹窗里要读文字，不能沿用外壳那档 0.42 的透。
- 外壳（标题栏 / 侧栏 / 输入区）**never** 与弹窗共用同一条背景声明，否则改一处会同时把另一处变实或变透（踩过：一条 `.titlebar,.sidebar,.dock,.modal,.drawer` 的合并规则，把三块外壳一起变成了不透明，玻璃感整个消失）。

## 机制：为什么必须 portal

- `backdrop-filter` 会让元素成为**包含块**（containing block），子元素里 `position: fixed` 的浮层不再是相对视口定位，而是相对这块玻璃。侧栏 290px 宽，于是弹窗遮罩只有 290px 宽。
- 侧栏同时是 `overflow-y: auto`，浮层超出部分被裁。
- 这两条叠加，结果就是"弹窗变窄 + 菜单缺一半"。

标题栏被侧栏盖住是另一回事：每块玻璃都成了独立层叠上下文，`.menu` 的 `z-index: 50` 只在标题栏内部有效，而侧栏是兄弟节点、DOM 顺序在后。修法是给 `.titlebar` 加 `position: relative; z-index: 30`（低于弹窗的 40，弹窗仍能盖住标题栏）。

## Alternatives considered

- **给侧栏去掉 `backdrop-filter`**：能一并解决定位与裁剪。代价是玻璃外壳只剩标题栏和输入区有效果，侧栏变成一块死板的实色，这正是本轮改版要避免的。
- **把浮层 `position: fixed` 改成 `absolute` 并手动算坐标**：不引入 portal，改动看似更小。但侧栏是滚动容器，用户一滚坐标全错，还要监听滚动重算。
- **提高 `.menu` 的 `z-index` 到 200**：直觉解法，实际无效——它抬不出标题栏这个层叠上下文（实测点开后菜单仍被侧栏压住）。
- **所有弹窗统一 0.42 透明（和外壳一致）**：视觉最统一。但正文压在图片上读不清，被否。
- **弹窗内部分区块各自设底色**：能保证可读。结果"外面透、里面实"，看起来像三块拼在一起，被用户否掉。

## Consequences

- 收益：弹窗宽度回到 560/660 的设计值；右键菜单完整可点；标题栏下拉不再被侧栏压住；外壳与弹窗的透明度各自独立可调。
- 代价 1：portal 让"弹窗属于哪个组件"在 DOM 上消失，读代码要靠 `createPortal` 那一行回溯；样式里 `:has(.settings)` 这类从内容反查外框的写法要继续保留。
- 代价 2：坐标要自己收敛（菜单按视口边界 clamp），比原生定位多一步。
- 代价 3：`backdrop-filter` 一旦被构建工具剥掉，整块玻璃静默失效——`vite.config.ts` 里给 CSS 设了 `target: "chrome130"`，且 **never** 再写 `-webkit-backdrop-filter` 回退（写了会让整条声明在 Chromium 里失效）。

## Testing

- 弹窗宽度：CDP 量 `.size-dialog` 的 `getBoundingClientRect().width`，实测 560（修复前约 300，父节点是 `.sidebar`）。
- 菜单遮挡：点开后取菜单区域中心的 `document.elementFromPoint`，判断命中节点是否在菜单内部（实测 `menuInside: true`），并比较菜单右边界与侧栏边界。
- 玻璃不透明度：分别读 `.titlebar` / `.sidebar` / `.dock` 与 `.modal` 的 `backgroundColor` + `backdropFilter`，确认外壳 0.42 + `blur(24px)`、弹窗 0.9 + `blur(30px)`。
- `npm run smoke` 覆盖弹窗开合与菜单交互主路径。
