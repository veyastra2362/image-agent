/**
 * 左侧配置栏：模型、数量、画面、参考图与高级设置。
 *
 * 提示词在右下角的输入框里，这里只放"参数"。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LIMITS } from "../../shared/image-generation.ts";
import { FORMAT_LABELS } from "../lib/output-spec.ts";
import { useComposer } from "./composer-state.tsx";
import { SizeDialog } from "./SizeDialog.tsx";
import { PanelLeftIcon } from "../shell/PanelLeftIcon.tsx";
import { Select } from "../shell/Select.tsx";
import { ModelSelect } from "../shell/ModelSelect.tsx";

export interface ConfigSidebarProps {
  readonly onCollapse: () => void;
}

export function ConfigSidebar({ onCollapse }: ConfigSidebarProps) {
  const {
    visibleModels,
    model,
    setModelKey,
    caps,
    effectiveSpec,
    customRatio,
    sizeSummary,
    sizeDialogOpen,
    setSizeDialogOpen,
    setSpec,
    setCustomRatio,
    count,
    setCount,
    effectiveCount,
    maxCount,
    seed,
    setSeed,
    negativePrompt,
    setNegativePrompt,
    referenceOptions,
    references,
    setReferenceFromAsset,
    referenceLimit,
    referenceValid,
    prompt,
  } = useComposer();

  // 悬停 1.5 秒才弹出大图预览，避免只是划过去就闪一下。
  // 菜单展开时不弹（菜单里本身有缩略图）；点选之后也要重新悬停才会再弹。
  const [peek, setPeek] = useState<{ x: number; y: number }>();
  const [menuOpen, setMenuOpen] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);

  const cancelPeek = () => {
    window.clearTimeout(peekTimer.current);
    setPeek(undefined);
  };

  const fieldRef = useRef<HTMLDivElement>(null);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;

  /** 进入这一格的时刻；配合 mousemove 兜底，手抖也不会把计时清零。 */
  const enteredAt = useRef(0);

  const showPeek = () => {
    const el = fieldRef.current;
    if (!el || menuOpenRef.current) return;
    const rect = el.getBoundingClientRect();
    setPeek({ x: rect.right + 10, y: rect.top });
  };

  const startPeek = () => {
    enteredAt.current = performance.now();
    window.clearTimeout(peekTimer.current);
    // 主路径：进入后静止 1.5 秒就弹。
    peekTimer.current = window.setTimeout(showPeek, 1500);
  };

  /** 指针在格子里移动时也检查一次：静止计时被浏览器节流时还有这条路。 */
  const movePeek = () => {
    if (menuOpenRef.current) return;
    if (peek !== undefined) return;
    if (enteredAt.current === 0) enteredAt.current = performance.now();
    if (performance.now() - enteredAt.current >= 1500) showPeek();
  };

  const stopPeek = () => {
    window.clearTimeout(peekTimer.current);
    setPeek(undefined);
  };

  // 选中项变化（例如刚点完某个选项）时收起大图，必须重新移入才再出现。
  useEffect(() => {
    window.clearTimeout(peekTimer.current);
    setPeek(undefined);
  }, [references.length]);

  return (
    <div className="sidebar__body">
      <div className="sidebar__head">
        <h2>配置</h2>
        <button
          type="button"
          className="sidebar__collapse"
          onClick={onCollapse}
          aria-label="收起侧栏"
          title="收起侧栏（Ctrl+B）"
        >
          <PanelLeftIcon size={14} />
        </button>
      </div>

      <label className="field">
        <span className="field__label">服务与模型</span>
        <ModelSelect
          ariaLabel="服务与模型"
          value={model ? `${model.id}:${model.model}` : ""}
          onChange={setModelKey}
          models={visibleModels}
          placeholder={visibleModels.length === 0 ? "没有可用模型" : "选择模型"}
        />
      </label>

      <div className="field">
        <span className="field__label">
          数量
          <span className="field__meta">最多 {maxCount} 张</span>
        </span>
        <input
          className="field__input"
          type="number"
          min={1}
          max={maxCount}
          value={effectiveCount}
          disabled={maxCount <= 1}
          onChange={(event) => setCount(Number(event.target.value))}
        />
      </div>

      <div className="field">
        <span className="field__label">
          画面
          <span className="field__meta">{FORMAT_LABELS[effectiveSpec.format]}</span>
        </span>
        <button
          type="button"
          className="size-button"
          onClick={() => setSizeDialogOpen(true)}
          aria-haspopup="dialog"
          aria-label={`画面设置：${sizeSummary}`}
        >
          <span className="size-button__main">{sizeSummary}</span>
          <span className="size-button__meta">
            {effectiveSpec.mode === "auto"
              ? "自动"
              : effectiveSpec.mode === "custom"
                ? "自定义宽高"
                : effectiveSpec.aspectRatio === "custom"
                  ? `${customRatio} · 自定义比例 · 短边 ${effectiveSpec.resolution}`
                  : `${effectiveSpec.aspectRatio} · 短边 ${effectiveSpec.resolution}`}
            {effectiveSpec.format === "png" ? "" : ` · 压缩 ${effectiveSpec.compression}`}
          </span>
        </button>
      </div>

      <div
        ref={fieldRef}
        className="field ref-field"
        onMouseEnter={startPeek}
        onMouseMove={movePeek}
        onMouseLeave={stopPeek}
        onMouseDown={stopPeek}
      >
        <span className="field__label">
          参考图
          {references.length > 0 && (
            <span className="field__meta">
              {Number.isFinite(referenceLimit) ? `${references.length} / ${referenceLimit}` : `${references.length} 张`}
            </span>
          )}
          {!caps?.imageToImage && <span className="field__meta">当前模型不支持</span>}
        </span>
        <Select
          ariaLabel="参考图"
          value=""
          placeholder={references.length > 0 ? `已选 ${references.length} 张，可继续添加` : "从作品库添加"}
          disabled={!caps?.imageToImage || referenceOptions.length === 0 || references.length >= referenceLimit}
          onChange={(next) => {
            if (next !== "") setReferenceFromAsset(next);
          }}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (open) cancelPeek();
          }}
          leading={
            references[0] === undefined ? undefined : (
              <img className="ref-field__thumb" src={references[0].src} alt="" />
            )
          }
          options={[
            { value: "", label: references.length > 0 ? "已选参考图" : "不使用参考图" },
            ...referenceOptions.map((option) => ({
              value: option.id,
              label: option.label,
              thumbnail: option.previewUrl,
            })),
          ]}
        />
        {caps?.imageToImage && referenceOptions.length === 0 && (
          <span className="field__hint">生成第一张图后，可以从作品库选一张作为参考图继续修改。</span>
        )}
      </div>
      {peek !== undefined && references[0] !== undefined && (
        createPortal(
          <div className="ref-peek" style={{ left: peek.x, top: peek.y }} role="presentation">
            <img src={references[0].src} alt="参考图预览" />
            <span>
              {references[0].width}×{references[0].height} · 共 {references.length} 张
            </span>
          </div>,
          document.body,
        )
      )}

      <details className="advanced">
        <summary>高级设置</summary>
        <div className="advanced__body">
          {caps?.seed && (
            <label className="field">
              <span className="field__label">Seed（可选）</span>
              <input
                className="field__input"
                type="text"
                inputMode="numeric"
                value={seed}
                onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder="随机"
              />
            </label>
          )}

          {caps?.negativePrompt && (
            <label className="field">
              <span className="field__label">负面提示词</span>
              <input
                className="field__input"
                value={negativePrompt}
                maxLength={LIMITS.negativePromptMaxLength}
                onChange={(event) => setNegativePrompt(event.target.value)}
                placeholder="不想出现的内容"
              />
            </label>
          )}

          <div className="composer__summary" aria-live="polite">
            <dl>
              <div>
                <dt>上传</dt>
                <dd>
                  {referenceValid && model?.uploadsUserAssets
                    ? `参考图将发送到「${model.displayName}」`
                    : "参考图不离开本机"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </details>

      {sizeDialogOpen && (
        <SizeDialog
          spec={effectiveSpec}
          customRatioLabel={customRatio}
          capabilities={caps}
          onCancel={() => setSizeDialogOpen(false)}
          onCommit={(next, ratioLabel) => {
            setSpec(next);
            setCustomRatio(ratioLabel);
            setSizeDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}
