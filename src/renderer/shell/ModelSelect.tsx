/**
 * 模型选择器：按服务商分组的列表。
 *
 * 和通用的 Select 分开，是因为模型列表天然是"服务商 → 模型"两级的，
 * 平铺一排 "服务商 · 模型" 读起来很累。分组标题 + 当前项打勾，
 * 触发器的箭头在展开时会旋转。
 */
import { useEffect, useRef, useState } from "react";
import type { ProviderRef } from "../../shared/image-generation.ts";

export interface ModelSelectProps {
  readonly models: readonly ProviderRef[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly compact?: boolean;
}

function modelKey(model: ProviderRef): string {
  return `${model.id}:${model.model}`;
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
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = models.find((model) => modelKey(model) === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node) !== true) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
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
        onClick={() => setOpen((current) => !current)}
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

      {open && (
        <ul className={`select__menu model-select__menu ${compact ? "model-select__menu--up" : ""}`} role="listbox" aria-label={ariaLabel}>
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
        </ul>
      )}
    </div>
  );
}
