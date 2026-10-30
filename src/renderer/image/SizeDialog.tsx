/**
 * 画面设置二级弹窗：三选一模式（自动 / 按比例 / 自定义宽高），
 * 外加基准分辨率、比例、自定义比例，以及输出格式与压缩率。
 *
 * 这里只负责"收集用户意图"，真正的合法性与能力校验在 main。
 * 弹窗会把当前模型不支持的选项禁用并说明原因，而不是让用户点了才失败。
 */
import { useEffect, useId, useRef, useState } from "react";
import {
  COMPRESSION_MAX,
  COMPRESSION_MIN,
  LIMITS,
  OUTPUT_FORMATS,
  RESOLUTION_TIERS,
  parseCustomRatio,
  resolveCustomRatioSize,
  resolveRatioSize,
  type ImageCapabilities,
  type OutputFormat,
  type OutputSpec,
  type ResolutionTier,
  type SizeMode,
} from "../../shared/image-generation.ts";
import { FORMAT_LABELS, RATIO_LABELS, TIER_LABELS, ratioOptions } from "../lib/output-spec.ts";

export interface SizeDialogProps {
  readonly spec: OutputSpec;
  readonly customRatioLabel: string;
  readonly capabilities: ImageCapabilities | undefined;
  readonly onCommit: (spec: OutputSpec, customRatioLabel: string) => void;
  readonly onCancel: () => void;
}

const MODES: readonly { readonly value: SizeMode; readonly label: string; readonly hint: string }[] = [
  { value: "auto", label: "自动", hint: "不指定尺寸，由模型自行决定" },
  { value: "ratio", label: "按比例", hint: "按比例 + 基准分辨率计算宽高" },
  { value: "custom", label: "自定义宽高", hint: "直接指定最终像素" },
];

export function SizeDialog({ spec, customRatioLabel, capabilities, onCommit, onCancel }: SizeDialogProps) {
  const formId = useId();
  const [draft, setDraft] = useState<OutputSpec>(spec);
  const [customRatio, setCustomRatio] = useState(customRatioLabel);
  const [ratioError, setRatioError] = useState<string>();
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const autoSupported = capabilities?.autoSize ?? false;
  const customSupported = capabilities?.customSize ?? false;
  const supportedRatios = capabilities?.aspectRatios ?? [];
  const transcode = capabilities?.transcode ?? false;

  const presetSize =
    draft.mode === "ratio" && draft.aspectRatio !== "custom"
      ? resolveRatioSize(draft.aspectRatio, draft.resolution)
      : undefined;

  function commit() {
    if (draft.mode === "ratio" && draft.aspectRatio === "custom") {
      const parsed = parseCustomRatio(customRatio);
      if (!parsed) {
        setRatioError("自定义比例格式不对，例如 16:10 或 2.35:1");
        return;
      }
      setRatioError(undefined);
      onCommit({ ...draft, aspectRatio: "custom" }, customRatio.trim());
      return;
    }
    setRatioError(undefined);
    onCommit(draft, customRatioLabel);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal size-dialog" role="dialog" aria-modal="true" aria-labelledby={`${formId}-title`}>
        <header className="modal__head">
          <h2 id={`${formId}-title`}>画面</h2>
          <button type="button" className="modal__close" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="modal__body">
          <fieldset className="segmented" aria-label="尺寸模式">
            {/* 滑块：跟着选中模式左右移动 */}
            <span
              className="segmented__thumb"
              aria-hidden="true"
              style={{ transform: `translateX(calc(${MODES.findIndex((mode) => mode.value === draft.mode)} * (100% + var(--space-1))))` }}
            />
            {MODES.map((mode, index) => {
              const disabled = mode.value === "auto" ? !autoSupported : mode.value === "custom" ? !customSupported : false;
              return (
                <label key={mode.value} className={`segmented__item ${draft.mode === mode.value ? "is-active" : ""}`}>
                  <input
                    ref={index === 0 ? firstRef : undefined}
                    type="radio"
                    name={`${formId}-mode`}
                    value={mode.value}
                    checked={draft.mode === mode.value}
                    disabled={disabled}
                    onChange={() =>
                      setDraft((current) => {
                        // 切到自定义宽高时补一个初值：否则输入框显示 1024 但草稿是空的，
                        // 底部预览会显示"请填写宽高"。
                        if (mode.value === "custom" && (current.width === undefined || current.height === undefined)) {
                          const fallback = resolveRatioSize(
                            current.aspectRatio === "custom" ? "1:1" : current.aspectRatio,
                            current.resolution,
                          );
                          return { ...current, mode: mode.value, width: fallback?.width ?? 1024, height: fallback?.height ?? 1024 };
                        }
                        return { ...current, mode: mode.value };
                      })
                    }
                  />
                  <span className="segmented__label">{mode.label}</span>
                  <span className="segmented__hint">{disabled ? "当前模型不支持" : mode.hint}</span>
                </label>
              );
            })}
          </fieldset>

          <div className="size-dialog__panel" key={draft.mode}>
          {draft.mode === "ratio" && (
            <div>
              <div className="field">
                <span className="field__label">基准分辨率</span>
                <div className="chips" role="radiogroup" aria-label="基准分辨率">
                  {RESOLUTION_TIERS.map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      role="radio"
                      aria-checked={draft.resolution === tier}
                      className={`chip ${draft.resolution === tier ? "is-active" : ""}`}
                      onClick={() => setDraft((current) => ({ ...current, resolution: tier as ResolutionTier }))}
                    >
                      {TIER_LABELS[tier]}
                    </button>
                  ))}
                </div>
                {draft.resolution === 4096 && (
                  <span className="field__hint field__hint--warn">
                    4K 只有官方 API 支持。第三方网关通常会静默回落到自己的默认尺寸（实测 1254×1254），
                    生成后若与请求不符会提示你。
                  </span>
                )}
              </div>

              <div className="field">
                <span className="field__label">
                  图像比例
                  <span className="field__meta">共 {ratioOptions().length} 种预设 + 自定义</span>
                </span>
                <div className="ratio-grid" role="radiogroup" aria-label="图像比例">
                  {ratioOptions().map((ratio) => {
                    const supported = supportedRatios.includes(ratio);
                    return (
                      <button
                        key={ratio}
                        type="button"
                        role="radio"
                        aria-checked={draft.aspectRatio === ratio}
                        className={`ratio ${draft.aspectRatio === ratio ? "is-active" : ""}`}
                        disabled={!supported}
                        title={supported ? RATIO_LABELS[ratio] : "当前模型不支持该比例"}
                        onClick={() => setDraft((current) => ({ ...current, aspectRatio: ratio }))}
                      >
                        <span className="ratio__shape" data-ratio={ratio} aria-hidden="true" />
                        <span className="ratio__label">{RATIO_LABELS[ratio]}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.aspectRatio === "custom"}
                    className={`ratio ratio--custom ${draft.aspectRatio === "custom" ? "is-active" : ""}`}
                    onClick={() => setDraft((current) => ({ ...current, aspectRatio: "custom" }))}
                  >
                    <span className="ratio__label">自定义比例</span>
                  </button>
                </div>
              </div>

              {draft.aspectRatio === "custom" && (
                <label className="field">
                  <span className="field__label">
                    自定义比例
                    <span className="field__meta">例如 16:10 / 2.35:1 / 1.5</span>
                  </span>
                  <input
                    className="field__input"
                    value={customRatio}
                    onChange={(event) => {
                      setCustomRatio(event.target.value);
                      setRatioError(undefined);
                    }}
                    placeholder="16:10"
                    aria-invalid={ratioError !== undefined}
                  />
                  {ratioError && <span className="field__hint field__hint--warn">{ratioError}</span>}
                </label>
              )}
            </div>
          )}

          {draft.mode === "custom" && (
            <div className="field-row">
              <label className="field">
                <span className="field__label">
                  宽
                  <span className="field__meta">{LIMITS.edgeMin}–{LIMITS.edgeMax}</span>
                </span>
                <input
                  className="field__input"
                  type="number"
                  min={LIMITS.edgeMin}
                  max={LIMITS.edgeMax}
                  step={8}
                  value={draft.width ?? 1024}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, width: clampEdge(Number(event.target.value)) }))
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">
                  高
                  <span className="field__meta">{LIMITS.edgeMin}–{LIMITS.edgeMax}</span>
                </span>
                <input
                  className="field__input"
                  type="number"
                  min={LIMITS.edgeMin}
                  max={LIMITS.edgeMax}
                  step={8}
                  value={draft.height ?? 1024}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, height: clampEdge(Number(event.target.value)) }))
                  }
                />
              </label>
            </div>
          )}
          {draft.mode === "auto" && (
            <p className="field__hint">自动模式下比例与分辨率不参与请求，上游给什么尺寸就用什么尺寸。</p>
          )}
          </div>

          <div className="field">
            <span className="field__label">
              输出格式
              {!transcode && <span className="field__meta">当前模型只能导出 PNG</span>}
            </span>
            <div className="chips" role="radiogroup" aria-label="输出格式">
              {OUTPUT_FORMATS.map((format) => (
                <button
                  key={format}
                  type="button"
                  role="radio"
                  aria-checked={draft.format === format}
                  className={`chip ${draft.format === format ? "is-active" : ""}`}
                  disabled={format !== "png" && !transcode}
                  onClick={() => setDraft((current) => ({ ...current, format: format as OutputFormat }))}
                >
                  {FORMAT_LABELS[format]}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field__label">
              压缩率
              <span className="field__meta">{compressionLabel(draft)}</span>
            </span>
            <input
              className="slider"
              type="range"
              min={COMPRESSION_MIN}
              max={COMPRESSION_MAX}
              step={1}
              value={draft.compression}
              disabled={draft.format === "png"}
              onChange={(event) => setDraft((current) => ({ ...current, compression: Number(event.target.value) }))}
            />
            <span className="field__hint">
              {draft.format === "png" ? "PNG 为无损格式，压缩率不生效。" : "数值越大文件越小、细节越少；由本机在保存前转码。"}
            </span>
          </label>


          {autoSupported && draft.mode === "auto" && (
            <p className="field__hint">自动模式下比例与分辨率不参与请求，上游给什么尺寸就用什么尺寸。</p>
          )}
          {draft.mode === "custom" && (
            <p className="field__hint">自定义尺寸会直接发给上游，超出其支持范围时会被拒绝。</p>
          )}
        </div>

        <footer className="modal__foot modal__foot--split">
          <p className="size-dialog__preview" aria-live="polite">
            {draft.mode === "auto"
              ? "由模型自行决定尺寸"
              : draft.mode === "custom"
                ? draft.width && draft.height
                  ? `将使用 ${draft.width}×${draft.height}`
                  : "请填写宽高"
                : draft.aspectRatio === "custom"
                  ? `将使用 ${customRatioPreviewText(customRatio, draft.resolution)}`
                  : presetSize
                    ? `将使用 ${presetSize.width}×${presetSize.height}`
                    : "比例不合法"}
          </p>
          <div className="modal__foot-actions">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="button button--primary" onClick={commit}>
            确定
          </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function clampEdge(value: number): number {
  if (!Number.isFinite(value)) return LIMITS.edgeMin;
  return Math.min(LIMITS.edgeMax, Math.max(LIMITS.edgeMin, Math.round(value)));
}

function compressionLabel(spec: OutputSpec): string {
  if (spec.format === "png") return "不适用";
  if (spec.compression === 0) return "0 · 画质优先";
  if (spec.compression === COMPRESSION_MAX) return `${COMPRESSION_MAX} · 体积优先`;
  return String(spec.compression);
}

function customRatioPreviewText(label: string, resolution: number): string {
  const parsed = parseCustomRatio(label);
  if (!parsed) return "自定义比例不合法";
  const size = resolveCustomRatioSize(label, resolution);
  return size ? `${size.width}×${size.height}` : "自定义比例不合法";
}