/**
 * 统一的下拉选择器。
 *
 * 系统原生 <select> 的箭头和边距在各平台/DPI 下不可控（用户反馈"图标贴边、间距难受"），
 * 所以自绘：外壳是一个圆角按钮，展开后是浮层菜单，选中项带勾。
 * 键盘：↑/↓ 移动，Enter 选中，Esc 关闭；点击外部关闭。
 */
import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  /** 紧凑版：用在底部输入框那一行。 */
  readonly compact?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
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
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node) !== true) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = options.findIndex((option) => option.value === value);
    setActiveIndex(index >= 0 ? index : 0);
  }, [open, options, value]);

  function commit(option: SelectOption) {
    if (option.disabled === true) return;
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open && (event.key === "Enter" || event.key === " " || event.key === "ArrowDown")) {
      event.preventDefault();
      setOpen(true);
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
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span className={`select__value ${selected === undefined ? "is-placeholder" : ""}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg className="select__chevron" width="10" height="10" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul className="select__menu" role="listbox" id={listId} aria-label={ariaLabel}>
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
                <span className="select__option-label">{option.label}</span>
                {option.value === value && (
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
