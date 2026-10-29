/**
 * 创作表单：提示词、模型、比例/尺寸、数量，以及 Agent 改写后的可编辑提示词。
 *
 * 只显示当前模型能力声明支持的控件；不支持的参数直接隐藏，而不是静默丢弃。
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ASPECT_RATIOS,
  LIMITS,
  validateCreateJobInput,
  type ImageTaskEvent,
  type ProviderRef,
} from "../../shared/image-generation.ts";
import { formatCost, newRequestId } from "../lib/format.ts";
import type { ImageAgentState } from "./use-image-agent.ts";

const RATIO_LABELS: Record<(typeof ASPECT_RATIOS)[number], string> = {
  "1:1": "1:1 方形",
  "4:3": "4:3 横向",
  "3:4": "3:4 竖向",
  "16:9": "16:9 宽屏",
  "9:16": "9:16 竖屏",
  "3:2": "3:2 横向",
  "2:3": "2:3 竖向",
};

interface ComposerProps {
  readonly state: ImageAgentState;
  readonly models: readonly ProviderRef[];
  readonly onSubmitted: () => void;
  readonly onOpenLastResult: () => void;
  /** 每次加一都会把焦点送回提示词输入框。 */
  readonly focusPromptToken: number;
}

export function Composer({ state, models, onSubmitted, onOpenLastResult, focusPromptToken }: ComposerProps) {
  const formId = useId();
  const [prompt, setPrompt] = useState("一只在雨夜窗边打盹的橘猫，柔和侧光，电影感");
  const [rewriteEnabled, setRewriteEnabled] = useState(false);
  const [rewritten, setRewritten] = useState("");
  const [modelKey, setModelKey] = useState<string>();
  const [aspectRatio, setAspectRatio] = useState<string>();
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [budgetLimit, setBudgetLimit] = useState("");
  const [referenceAssetId, setReferenceAssetId] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [pending, setPending] = useState(false);
  // 每次提交换一个 requestId：同一个 id 重提会被 main 当成重复请求（幂等保护）。
  const [requestId, setRequestId] = useState(newRequestId);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusPromptToken > 0) promptRef.current?.focus();
  }, [focusPromptToken]);

  const model = useMemo(() => resolveModel(models, modelKey), [models, modelKey]);
  const caps = model?.capabilities;
  const supportedRatios = caps?.aspectRatios ?? [];
  const ratio = aspectRatio && supportedRatios.includes(aspectRatio as never) ? aspectRatio : supportedRatios[0];
  const maxCount = caps?.outputCountLimit ?? 1;
  const effectiveCount = Math.min(Math.max(1, count), maxCount);

  const referenceOptions = referenceSources(state);
  const referenceValid =
    referenceAssetId !== undefined &&
    referenceOptions.some((option) => option.id === referenceAssetId) &&
    (caps?.imageToImage ?? false);

  const submittedPrompt = rewriteEnabled && rewritten.trim() ? rewritten.trim() : prompt.trim();
  const validation = validateCreateJobInput({
    requestId,
    providerId: model?.id ?? "",
    ...(model === undefined ? {} : { model: model.model }),
    prompt,
    ...(rewriteEnabled && rewritten.trim() ? { agentPrompt: rewritten.trim() } : {}),
    ...(!referenceValid || referenceAssetId === undefined ? {} : { referenceAssetIds: [referenceAssetId] }),
    ...(ratio === undefined ? {} : { aspectRatio: ratio }),
    count: effectiveCount,
    ...(caps?.seed && seed.trim() !== "" ? { seed: Number(seed) } : {}),
    ...(caps?.negativePrompt && negativePrompt.trim() !== "" ? { negativePrompt } : {}),
    ...(budgetLimit.trim() === "" ? {} : { budgetLimit: Number(budgetLimit) }),
  });
  const canSubmit = validation.ok && model !== undefined && !pending && state.status === "ready";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validation.ok || pending) return;
    setPending(true);
    setSubmitError(undefined);
    const result = await state.submit(validation.value);
    setPending(false);
    if (!result.ok) setSubmitError(result.message ?? "提交失败");
    else {
      setRequestId(newRequestId());
      onSubmitted();
    }
  }

  function loadRewriteSource() {
    setRewriteEnabled(true);
    if (!rewritten.trim()) setRewritten(prompt.trim());
  }

  return (
    <form className="composer" onSubmit={handleSubmit} aria-labelledby={`${formId}-title`}>
      <div className="composer__head">
        <h2 id={`${formId}-title`}>创作</h2>
        <span className="composer__hint">自然语言描述，或直接使用改写结果</span>
      </div>

      <label className="field">
        <span className="field__label">
          提示词
          <span className="field__meta">
            {[...prompt.trim()].length}/{LIMITS.promptMaxLength}
          </span>
        </span>
        <textarea
          ref={promptRef}
          className="field__input field__input--prompt"
          value={prompt}
          rows={5}
          maxLength={LIMITS.promptMaxLength * 2}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="描述主体、风格、构图、光线和用途…"
          aria-describedby={`${formId}-prompt-hint`}
        />
      </label>
      <p id={`${formId}-prompt-hint`} className="field__hint">
        原始提示词会原样保存在作品记录里，发送给服务商的是下方确认后的版本。
      </p>

      <section className="rewrite" aria-labelledby={`${formId}-rewrite-title`}>
        <div className="rewrite__head">
          <h3 id={`${formId}-rewrite-title`} className="rewrite__title">
            Agent 改写
          </h3>
          <label className="switch">
            <input
              type="checkbox"
              checked={rewriteEnabled}
              onChange={(event) => (event.target.checked ? loadRewriteSource() : setRewriteEnabled(false))}
            />
            <span>使用改写提示词</span>
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
                重置为原始提示词
              </button>
              <button type="button" className="button button--ghost" onClick={() => setRewriteEnabled(false)}>
                关闭改写
              </button>
            </div>
          </>
        ) : (
          <p className="field__hint">当前未使用改写，提示词按原样发送。S7 会接入真正的规划器。</p>
        )}
      </section>

      <div className="field-row">
        <label className="field">
          <span className="field__label">服务与模型</span>
          <select
            className="field__input"
            value={model ? `${model.id}:${model.model}` : ""}
            onChange={(event) => setModelKey(event.target.value)}
          >
            {models.length === 0 && <option value="">没有可用模型</option>}
            {models.map((candidate) => (
              <option key={`${candidate.id}:${candidate.model}`} value={`${candidate.id}:${candidate.model}`}>
                {candidate.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">画面比例 / 尺寸</span>
          <select
            className="field__input"
            value={ratio ?? ""}
            disabled={!caps || supportedRatios.length === 0}
            onChange={(event) => setAspectRatio(event.target.value)}
          >
            {supportedRatios.map((value) => (
              <option key={value} value={value}>
                {RATIO_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field-row">
        <label className="field">
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
        </label>

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
      </div>

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

      <label className="field">
        <span className="field__label">
          参考图
          {!caps?.imageToImage && <span className="field__meta">当前模型不支持</span>}
        </span>
        <select
          className="field__input"
          value={referenceValid ? referenceAssetId : ""}
          disabled={!caps?.imageToImage || referenceOptions.length === 0}
          onChange={(event) => setReferenceAssetId(event.target.value || undefined)}
        >
          <option value="">不使用参考图</option>
          {referenceOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {caps?.imageToImage && referenceOptions.length === 0 && (
          <span className="field__hint">生成第一张图后，可以从作品库选一张作为参考图继续修改。</span>
        )}
      </label>

      {model && (
        <label className="field">
          <span className="field__label">
            本次预算上限（可选）
            <span className="field__meta">上游价格见右侧</span>
          </span>
          <input
            className="field__input"
            type="text"
            inputMode="decimal"
            value={budgetLimit}
            onChange={(event) => setBudgetLimit(event.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="未填写则不按预算拦截"
          />
        </label>
      )}

      <div className="composer__summary" aria-live="polite">
        <dl>
          <div>
            <dt>预计费用</dt>
            <dd>{costOf(model, effectiveCount)}</dd>
          </div>
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

      {submitError && (
        <p className="form-error" role="alert">
          {submitError}
        </p>
      )}
      {!validation.ok && prompt.trim() !== "" && (
        <p className="field__hint field__hint--warn">{validation.error.message}</p>
      )}

      <div className="composer__actions">
        <button type="submit" className="button button--primary" disabled={!canSubmit}>
          {pending ? "提交中…" : `生成 ${effectiveCount} 张`}
        </button>
        <button type="button" className="button button--ghost" onClick={onOpenLastResult}>
          查看最新结果
        </button>
      </div>
    </form>
  );
}

function resolveModel(models: readonly ProviderRef[], key: string | undefined): ProviderRef | undefined {
  if (key) {
    const found = models.find((candidate) => `${candidate.id}:${candidate.model}` === key);
    if (found) return found;
  }
  return models.find((candidate) => candidate.default) ?? models[0];
}

function costOf(model: ProviderRef | undefined, count: number): string {
  if (!model) return "—";
  if (!model.costPerImage || !model.currency) return "上游未提供";
  return `${(model.costPerImage * count).toFixed(4)} ${model.currency}`;
}

function referenceSources(state: ImageAgentState) {
  const options = new Map<string, { id: string; label: string }>();
  for (const entry of state.jobs) {
    for (const asset of entry.assets) {
      options.set(asset.id, {
        id: asset.id,
        label: `${asset.prompt.slice(0, 18)}… · ${asset.width}×${asset.height}`,
      });
    }
  }
  for (const asset of state.remembered) {
    if (!options.has(asset.id)) {
      options.set(asset.id, { id: asset.id, label: `${asset.prompt.slice(0, 18)}… · 历史记忆` });
    }
  }
  return [...options.values()];
}
