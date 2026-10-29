/**
 * 左侧配置栏：模型、数量、画面、参考图与高级设置。
 *
 * 提示词在右下角的输入框里，这里只放"参数"。
 */
import { LIMITS } from "../../shared/image-generation.ts";
import { FORMAT_LABELS } from "../lib/output-spec.ts";
import { useComposer } from "./composer-state.tsx";
import { SizeDialog } from "./SizeDialog.tsx";
import { PanelLeftIcon } from "../shell/PanelLeftIcon.tsx";
import { Select } from "../shell/Select.tsx";

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
    referenceAssetId,
    setReferenceAssetId,
    referenceValid,
    rewriteEnabled,
    setRewriteEnabled,
    rewritten,
    setRewritten,
    loadRewriteSource,
    prompt,
  } = useComposer();

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
        <Select
          ariaLabel="服务与模型"
          value={model ? `${model.id}:${model.model}` : ""}
          onChange={setModelKey}
          placeholder={visibleModels.length === 0 ? "没有可用模型" : "选择模型"}
          options={visibleModels.map((candidate) => ({
            value: `${candidate.id}:${candidate.model}`,
            label: candidate.displayName,
          }))}
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

      <label className="field">
        <span className="field__label">
          参考图
          {!caps?.imageToImage && <span className="field__meta">当前模型不支持</span>}
        </span>
        <Select
          ariaLabel="参考图"
          value={referenceValid ? (referenceAssetId ?? "") : ""}
          disabled={!caps?.imageToImage || referenceOptions.length === 0}
          onChange={(next) => setReferenceAssetId(next === "" ? undefined : next)}
          options={[
            { value: "", label: "不使用参考图" },
            ...referenceOptions.map((option) => ({ value: option.id, label: option.label })),
          ]}
        />
        {caps?.imageToImage && referenceOptions.length === 0 && (
          <span className="field__hint">生成第一张图后，可以从作品库选一张作为参考图继续修改。</span>
        )}
      </label>

      <details className="advanced">
        <summary>高级设置</summary>
        <div className="advanced__body">
          <section className="rewrite" aria-labelledby="rewrite-title">
            <div className="rewrite__head">
              <h3 id="rewrite-title" className="rewrite__title">
                Agent 改写
              </h3>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={rewriteEnabled}
                  onChange={(event) => (event.target.checked ? loadRewriteSource() : setRewriteEnabled(false))}
                />
                <span>使用改写</span>
              </label>
            </div>
            {rewriteEnabled ? (
              <>
                <textarea
                  className="field__input field__input--rewrite"
                  rows={4}
                  value={rewritten}
                  maxLength={LIMITS.agentPromptMaxLength * 2}
                  onChange={(event) => setRewritten(event.target.value)}
                  aria-label="Agent 改写后的提示词（可编辑）"
                />
                <div className="rewrite__actions">
                  <button type="button" className="button button--ghost" onClick={() => setRewritten(prompt.trim())}>
                    重置
                  </button>
                  <button type="button" className="button button--ghost" onClick={() => setRewriteEnabled(false)}>
                    关闭
                  </button>
                </div>
              </>
            ) : (
              <p className="field__hint">当前未使用改写，提示词按原样发送。</p>
            )}
          </section>

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
              <div>
                <dt>改写</dt>
                <dd>{rewriteEnabled && rewritten.trim() ? "发送改写版" : "按原样发送"}</dd>
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
