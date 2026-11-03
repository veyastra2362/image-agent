/**
 * 滚动条自动隐藏：只有"正在滚动"的那块区域才显示滑块，停手后淡出。
 *
 * 为什么不用 :hover：滚动条伪元素只认滚动容器自己的状态，
 * 而滚动容器分布在各种嵌套层级（.joblist / .canvas / .picker-list …），
 * 逐个列选择器既脆弱又会漏。这里用一次捕获阶段的 scroll 监听，
 * 给真正在滚的元素临时加 data-scrolling，样式表只管这个属性。
 */

const HIDE_DELAY_MS = 900;
const timers = new WeakMap<Element, number>();

function markScrollActivity(target: EventTarget | null): void {
  const node = target instanceof Element ? target : document.documentElement;
  node.setAttribute("data-scrolling", "");
  const existing = timers.get(node);
  if (existing !== undefined) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    node.removeAttribute("data-scrolling");
    timers.delete(node);
  }, HIDE_DELAY_MS);
  timers.set(node, timer);
}

export function enableAutoHideScrollbars(): () => void {
  const onScroll = (event: Event) => markScrollActivity(event.target);
  // capture：滚动事件不冒泡，必须用捕获阶段才能收到任意容器的滚动。
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => document.removeEventListener("scroll", onScroll, { capture: true });
}
