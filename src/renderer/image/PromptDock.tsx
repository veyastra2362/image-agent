/**
 * 右下角的提示词输入框：参考图缩略图 + 提示词 + 上传/生成按钮。
 *
 * 参考图有两个入口：点击上传按钮选文件，或者直接 Ctrl+V 把剪贴板里的图片贴进来。
 * 缩略图放在输入框上方，点击看原图（走全局 lightbox）。
 */
import { useId, useRef } from "react";
import { LIMITS } from "../../shared/image-generation.ts";
import { useComposer } from "./composer-state.tsx";
import { ModelSelect } from "../shell/ModelSelect.tsx";
import { useT } from "../lib/i18n.ts";
import { CloseIcon, ImagePlusIcon } from "../shell/icons.tsx";

export function PromptDock() {
  const formId = useId();
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
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
    visibleModels,
    model,
    setModelKey,
    references,
    uploadReference,
    clearReference,
    clearAllReferences,
    referenceBusy,
    referenceLimit,
  } = useComposer();

  const invalid = !validation.ok && prompt.trim() !== "";
  const referenceEnabled = caps?.imageToImage === true;

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

      {/* 参考图预览：贴在输入框上方，点击看原图 */}
      {references.length > 0 && (
        <div className="dock__refs" aria-label={`参考图 ${references.length} 张`}>
          {references.map((reference) => (
            <figure key={reference.id} className="dock__ref">
              <button
                type="button"
                className="dock__ref-button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("image-agent:zoom", { detail: { src: reference.src, alt: "参考图" } }),
                  )
                }
                aria-label="查看参考图原图"
              >
                <img src={reference.src} alt="参考图" />
              </button>
              <button
                type="button"
                className="dock__ref-remove"
                onClick={() => clearReference(reference.id)}
                aria-label="移除参考图"
              >
                <CloseIcon size={9} />
              </button>
              <figcaption>
                {reference.width}×{reference.height}
              </figcaption>
            </figure>
          ))}
          {Number.isFinite(referenceLimit) && references.length < referenceLimit && (
            <span className="dock__ref-hint">可再加 {referenceLimit - references.length} 张</span>
          )}
          {references.length >= 2 && (
            <button type="button" className="dock__ref-clear" onClick={clearAllReferences} title="清空所有参考图">
              <CloseIcon size={9} />
              清空
            </button>
          )}
        </div>
      )}

      <div className="dock__input-row">
        <textarea
          ref={promptRef}
          className="dock__input"
          value={prompt}
          rows={2}
          maxLength={LIMITS.promptMaxLength * 2}
          onChange={(event) => setPrompt(event.target.value)}
          onPaste={(event) => {
            if (!referenceEnabled) return;
            const file = [...event.clipboardData.items]
              .find((item) => item.kind === "file" && item.type.startsWith("image/"))
              ?.getAsFile();
            if (file === null || file === undefined) return;
            // 粘贴图片时不要让 base64 文本落进输入框。
            event.preventDefault();
            void uploadReference(file);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={
            referenceEnabled
              ? "描述你想要的画面… Enter 生成，Shift+Enter 换行，可 Ctrl+V 粘贴参考图"
              : "描述你想要的画面… Enter 生成，Shift+Enter 换行"
          }
          aria-describedby={`${formId}-hint`}
        />
      </div>

      <div className="dock__bar">
        <div className="dock__meta">
          {/* 在这里也能换模型：改完提示词不用再回到左侧栏 */}
          <ModelSelect
            compact
            ariaLabel="选择模型"
            value={model ? `${model.id}:${model.model}` : ""}
            onChange={setModelKey}
            models={visibleModels}
            placeholder={t("dock.noModel")}
          />
          <span className="dock__chip">{sizeSummary}</span>
          <span className="dock__count">
            {[...prompt.trim()].length}/{LIMITS.promptMaxLength}
          </span>
        </div>

        <div className="dock__actions">
          {/* 参考图上传：没有参考图能力时按钮禁用并说明原因 */}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) void uploadReference(file);
            }}
          />
          <button
            type="button"
            className="button button--ghost dock__upload"
            disabled={!referenceEnabled || referenceBusy}
            title={referenceEnabled ? "上传参考图（也可以 Ctrl+V 粘贴）" : "当前模型不支持参考图"}
            aria-label="上传参考图"
            aria-busy={referenceBusy}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlusIcon size={16} />
          </button>
          <button type="submit" className="button button--primary dock__submit" disabled={!canSubmit}>
            {pending ? t("dock.generating") : `${t("dock.generate")} ${effectiveCount}`}
          </button>
        </div>
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
