/**
 * 滚动条自动隐藏：滚动时、或鼠标停在这块可滚区域上时显示滑块，其余时候隐藏。
 *
 * 为什么不全用 CSS :hover：滚动条伪元素只认滚动容器自身的状态，
 * 而滚动容器散落在各个层级（.joblist / .canvas / .picker-list …），
 * 用选择器逐个列既脆弱又会漏。这里统一用 JS 打标：
 *   data-scrolling  —— 正在滚动（停手 900ms 后摘掉）
 *   data-scroll-hover —— 鼠标在这块可滚区域上（提示"这里能滚"）
 */

const HIDE_DELAY_MS = 900;
const timers = new WeakMap<Element, number>();
let hovered: Element[] = [];

function isScrollable(el: Element): boolean {
  if (el.scrollHeight > el.clientHeight + 2) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return true;
  }
  if (el.scrollWidth > el.clientWidth + 2) {
    const overflowX = getComputedStyle(el).overflowX;
    if (overflowX === "auto" || overflowX === "scroll") return true;
  }
  return false;
}

function clearHover(): void {
  for (const el of hovered) el.removeAttribute("data-scroll-hover");
  hovered = [];
}

function markHover(event: Event): void {
  clearHover();
  // composedPath 比 parentElement 链更可靠：能穿过 shadow DOM 和 portal 起点
  for (const node of event.composedPath()) {
    if (node instanceof Element && isScrollable(node)) {
      node.setAttribute("data-scroll-hover", "");
      hovered.push(node);
      return;
    }
  }
}

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
  document.addEventListener("pointerover", markHover, { passive: true });
  document.addEventListener("pointerout", (event) => {
    if (event.relatedTarget === null) clearHover();
  });
  window.addEventListener("blur", clearHover);

  return () => {
    document.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("pointerover", markHover);
    window.removeEventListener("blur", clearHover);
    clearHover();
  };
}
