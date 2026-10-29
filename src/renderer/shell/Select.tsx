/**
 * 统一的下拉选择器。
 *
 * 原生 <select> 的箭头与内边距不可控，所以自绘。菜单用 portal 渲染到 body：
 * 设置面板的滚动容器会裁剪 `overflow: hidden` 里的绝对定位元素，之前就是
 * "点了没反应"（其实菜单被裁掉了）。portal + fixed 定位后不会再被裁剪，
 * 下方空间不够时自动向上展开；箭头在展开时旋转。
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** 选项左侧的小缩略图（参考图之类）。 */
  readonly thumbnail?: string;
}

export interface SelectProps {
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly compact?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  /** 触发器里放在文字前面的东西（比如参考图缩略图）。 */
  readonly leading?: ReactNode;
  /** 展开/收起回调：外部需要知道菜单是否打开（比如悬停预览要避开菜单）。 */
  readonly onOpenChange?: (open: boolean) => void;
}

interface MenuRect {
  readonly left: number;
  readonly width: number;
  readonly top: number;
  readonly maxHeight: number;
}

const MENU_MAX = 340;

/**
 * 只用 top 定位。
 *
 * 之前向上展开用了 `bottom`，但 fixed 元素的包含块并不是视口（实测比视口高），
 * bottom 会把菜单画到窗口外面去 —— 表现就是"点了没东西"。统一用 top 就不会。
 */
function measure(trigger: HTMLElement, itemCount: number): MenuRect {
  const rect = trigger.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  const above = rect.top;
  const estimate = Math.min(MENU_MAX, itemCount * 34 + 12);
  const openUp = below < Math.min(MENU_MAX, 180) && above > below;
  const maxHeight = Math.max(160, Math.min(MENU_MAX, (openUp ? above : below) - 12));
  const height = Math.min(estimate, maxHeight);
  return {
    left: rect.left,
    width: Math.max(rect.width, 200),
    top: openUp ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
    maxHeight,
  };
}

export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "请选择",
  compact = false,
  disabled = false,
  className,
  leading,
  onOpenChange,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<MenuRect>();
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  const openMenu = () => {
    const trigger = rootRef.current?.querySelector<HTMLButtonElement>(".select__trigger");
    if (!trigger) return;
    setRect(measure(trigger, options.length));
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
    onOpenChange?.(true);
  };

  useEffect(() => {
    if (!open) onOpenChange?.(false);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) === true) return;
      if (menuRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // 滚动/缩放时直接收起，避免菜单跟触发器错位。
    const onScroll = () => setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function commit(option: SelectOption) {
    if (option.disabled === true) return;
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open && (event.key === "Enter" || event.key === " " || event.key === "ArrowDown")) {
      event.preventDefault();
      openMenu();
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) commit(option);
    }
  }

  return (
    <div className={`select ${compact ? "select--compact" : ""} ${className ?? ""}`} ref={rootRef}>
      <button
        type="button"
        className={`select__trigger ${open ? "is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        {leading}
        <span className={`select__value ${selected === undefined ? "is-placeholder" : ""}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          className="select__chevron"
          width="10"
          height="10"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}
        >
          <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open &&
        rect !== undefined &&
        createPortal(
          <ul
            className="select__menu select__menu--portal"
            role="listbox"
            id={listId}
            aria-label={ariaLabel}
            ref={menuRef}
            style={{ left: rect.left, top: rect.top, width: rect.width, maxHeight: rect.maxHeight }}
          >
            {options.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`select__option ${option.value === value ? "is-selected" : ""} ${index === activeIndex ? "is-active" : ""}`}
                  disabled={option.disabled === true}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(option)}
                >
                  {option.thumbnail !== undefined && (
                    <img className="select__option-thumb" src={option.thumbnail} alt="" loading="lazy" />
                  )}
                  <span className="select__option-label">{option.label}</span>
                  {option.value === value && (
                    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
