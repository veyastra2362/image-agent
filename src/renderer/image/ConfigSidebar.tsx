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
    clearReference,
    referenceLimit,
    referenceValid,
    agentOptimize,
    setAgentOptimize,
    prompt,
  } = useComposer();

  // 悬停 1.5 秒把缩略图放大：纯 CSS（:hover + transition-delay），
  // 之前用 JS 计时器 + portal，被重渲染打断后就不再出现。
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

      <div className="field ref-field">
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
          placeholder={references.length > 0 ? `已选 ${references.length} 张` : "从作品库添加"}
          selectedValues={references.map((item) => item.id)}
          keepOpenOnSelect
          previewOnHover
          menuMinWidth={300}
          disabled={!caps?.imageToImage || referenceOptions.length === 0 || references.length >= referenceLimit}
          onChange={(next) => {
            // 多选：已选中的再点一次就取消。
            if (next === "") return;
            if (references.some((item) => item.id === next)) clearReference(next);
            else setReferenceFromAsset(next);
          }}

          leading={
            references[0] === undefined ? undefined : (
              <img className="ref-field__thumb" src={references[0].src} alt="" />
            )
          }
          options={[
            ...referenceOptions.map((option) => ({
              value: option.id,
              label: option.label,
              meta: option.meta,
              thumbnail: option.previewUrl,
            })),
          ]}
        />
        {caps?.imageToImage && referenceOptions.length === 0 && (
          <span className="field__hint">生成第一张图后，可以从作品库选一张作为参考图继续修改。</span>
        )}
      </div>


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

          <label className="switch-field">
            <span className="switch-field__text">
              <span className="field__label">Agent 优化提示词</span>
              <span className="field__hint">
                {model?.agentModel === undefined
                  ? "需要先在 设置 → API 设置 里填写「Agent 模型」才能用"
                  : `生成前用 ${model.agentModel} 改写这句提示词`}
              </span>
            </span>
            <input
              type="checkbox"
              className="switch"
              role="switch"
              aria-label="Agent 优化提示词"
              checked={agentOptimize}
              disabled={model?.agentModel === undefined}
              onChange={(event) => setAgentOptimize(event.target.checked)}
            />
          </label>
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