/**
 * 模型选择器：按服务商分组的列表。
 *
 * 和通用的 Select 一样用 portal 渲染菜单（避免被滚动容器裁剪），
 * 区别是内容分两级：服务商标题 + 该服务商下的模型。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ProviderRef } from "../../shared/image-generation.ts";

export interface ModelSelectProps {
  readonly models: readonly ProviderRef[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly compact?: boolean;
}

const MENU_MAX = 320;

function modelKey(model: ProviderRef): string {
  return `${model.id}:${model.model}`;
}

/** 只用 top 定位：fixed 的包含块不是视口，用 bottom 会把菜单画到窗口外。 */
function measure(trigger: HTMLElement, itemCount: number) {
  const rect = trigger.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  const above = rect.top;
  const estimate = Math.min(MENU_MAX, itemCount * 34 + 16);
  const openUp = below < 220 && above > below;
  const maxHeight = Math.max(140, Math.min(MENU_MAX, (openUp ? above : below) - 8));
  const height = Math.min(estimate, maxHeight);
  return {
    left: rect.left,
    width: Math.max(rect.width, 240),
    top: openUp ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
    maxHeight,
  };
}

export function ModelSelect({
  models,
  value,
  onChange,
  ariaLabel = "选择模型",
  placeholder = "没有可用模型",
  compact = false,
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<ReturnType<typeof measure>>();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const selected = models.find((model) => modelKey(model) === value);

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

  // 分组顺序按 provider 首次出现的位置，保证列表稳定。
  const groups: { provider: string; items: ProviderRef[] }[] = [];
  for (const model of models) {
    const group = groups.find((entry) => entry.provider === model.providerDisplayName);
    if (group) group.items.push(model);
    else groups.push({ provider: model.providerDisplayName, items: [model] });
  }

  return (
    <div className={`select model-select ${compact ? "select--compact" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`select__trigger ${open ? "is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={models.length === 0}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const trigger = rootRef.current?.querySelector<HTMLButtonElement>(".select__trigger");
          if (!trigger) return;
          setRect(measure(trigger, models.length + groups.length));
          setOpen(true);
        }}
      >
        <span className={`select__value ${selected === undefined ? "is-placeholder" : ""}`}>
          {selected?.displayName ?? placeholder}
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
            className="select__menu select__menu--portal model-select__menu"
            role="listbox"
            aria-label={ariaLabel}
            ref={menuRef}
            style={{ left: rect.left, top: rect.top, width: rect.width, maxHeight: rect.maxHeight }}
          >
            {groups.map((group) => (
              <li key={group.provider} className="model-select__group">
                <div className="model-select__group-title">{group.provider}</div>
                <ul className="model-select__group-list">
                  {group.items.map((model) => {
                    const key = modelKey(model);
                    const active = key === value;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={`select__option model-select__option ${active ? "is-selected" : ""}`}
                          onClick={() => {
                            onChange(key);
                            setOpen(false);
                          }}
                        >
                          <span className="select__option-label">{model.modelDisplayName || model.model}</span>
                          {model.default && <span className="model-select__badge">默认</span>}
                          {active && (
                            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                              <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
