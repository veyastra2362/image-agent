/**
 * 右下角的提示词输入框：一行提示词 + 生成按钮。
 *
 * 表单在这里，所以 Enter/Ctrl+Enter 与按钮点击走同一个提交路径。
 */
import { useId } from "react";
import { LIMITS } from "../../shared/image-generation.ts";
import { useComposer } from "./composer-state.tsx";

export function PromptDock() {
  const formId = useId();
  const {
    prompt,
    setPrompt,
    promptRef,
    validation,
    canSubmit,
    pending,
    submit,
    submitError,
    effectiveCount,
    sizeSummary,
    caps,
    models,
    model,
    setModelKey,
  } = useComposer();

  const invalid = !validation.ok && prompt.trim() !== "";

  return (
    <form
      className="dock"
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 id={`${formId}-title`} className="visually-hidden">
        提示词
      </h2>
      <div className="dock__input-row">
        <textarea
          ref={promptRef}
          className="dock__input"
          value={prompt}
          rows={2}
          maxLength={LIMITS.promptMaxLength * 2}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="描述你想要的画面… Enter 生成，Shift+Enter 换行"
          aria-describedby={`${formId}-hint`}
        />
      </div>

      <div className="dock__bar">
        <div className="dock__meta">
          {/* 在这里也能换模型：改完提示词不用再回到左侧栏 */}
          <select
            className="dock__model"
            aria-label="选择模型"
            value={model ? `${model.id}:${model.model}` : ""}
            disabled={models.length === 0}
            onChange={(event) => setModelKey(event.target.value)}
          >
            {models.length === 0 && <option value="">没有可用模型</option>}
            {models.map((candidate) => (
              <option key={`${candidate.id}:${candidate.model}`} value={`${candidate.id}:${candidate.model}`}>
                {candidate.displayName}
              </option>
            ))}
          </select>
          <span className="dock__chip">{sizeSummary}</span>
          {caps?.imageToImage === false && <span className="dock__chip dock__chip--muted">无参考图</span>}
          <span className="dock__count">
            {[...prompt.trim()].length}/{LIMITS.promptMaxLength}
          </span>
        </div>
        <button type="submit" className="button button--primary dock__submit" disabled={!canSubmit}>
          {pending ? "提交中…" : `生成 ${effectiveCount} 张`}
        </button>
      </div>

      <div id={`${formId}-hint`} className="dock__messages" aria-live="polite">
        {submitError !== undefined && (
          <p className="form-error" role="alert">
            {submitError}
          </p>
        )}
        {invalid && <p className="field__hint field__hint--warn">{validation.error.message}</p>}
      </div>
    </form>
  );
}
