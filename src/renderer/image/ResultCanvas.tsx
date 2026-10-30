/**
 * 结果画布：运行中的任务卡片 + 已完成作品的网格。
 *
 * 空态不是控制台：一张图都没有时说明下一步；有任务时优先展示进行中的进度和取消入口。
 */
import { useState, type CSSProperties } from "react";
import type { ImageTaskEvent } from "../../shared/image-generation.ts";
import { formatDuration } from "../lib/format.ts";
import { describeStatus } from "../lib/job-status.ts";
import { cancellable, latestSucceededJob, type ImageAgentState } from "./use-image-agent.ts";
import { formatElapsed, useTick } from "../lib/use-tick.ts";
import { FolderIcon, RetryIcon } from "../shell/icons.tsx";

interface ResultCanvasProps {
  readonly state: ImageAgentState;
  readonly onOpenAsset: (assetId: string) => void;
}

function openZoom(src: string, alt: string): void {
  window.dispatchEvent(new CustomEvent("image-agent:zoom", { detail: { src, alt } }));
}

export function ResultCanvas({ state, onOpenAsset }: ResultCanvasProps) {
  const onRetry = (jobId: string) => void state.retry(jobId);

  const active = state.jobs.filter((entry) => describeStatus(entry.job.status).active);
  // 成功与失败放在同一条时间线上按时间排，失败不再单独堆在顶部。
  const timeline = state.jobs
    .filter((entry) => entry.job.status === "succeeded" || entry.job.status === "failed")
    .slice()
    .sort((a, b) => (b.job.createdAt ?? 0) - (a.job.createdAt ?? 0));
  const completed = state.jobs.filter((entry) => entry.job.status === "succeeded" && entry.assets.length > 0);
  const problems = state.jobs.filter((entry) => entry.job.status === "failed");

  const latest = latestSucceededJob(state.jobs);
  const knownIds = new Set(state.jobs.flatMap((entry) => entry.assets.map((asset) => asset.id)));
  const historyOnly = state.remembered.filter((asset) => !knownIds.has(asset.id));

  const empty = active.length === 0 && completed.length === 0 && historyOnly.length === 0 && problems.length === 0;
  // 空状态文案要跟真实情况一致：没配服务商时提示去配置，而不是说"只有离线假服务"。
  const hasRealProvider = state.models.some((model) => !model.id.includes("fake"));
  const noModels = state.models.length === 0;

  return (
    <section className="canvas" aria-labelledby="canvas-title">
      <header className="canvas__head">
        <h2 id="canvas-title">结果</h2>
        <div className="canvas__meta">
          <span>{state.jobs.length} 个任务</span>

        </div>
      </header>

      {state.status === "loading" && <p className="canvas__placeholder">正在连接主进程…</p>}

      {state.status === "unavailable" && (
        <div className="notice notice--warn" role="status">
          <strong>当前页面不在桌面应用中运行</strong>
          <p>请通过 npm run dev 或构建后的应用窗口打开，浏览器标签页无法访问本机图像服务。</p>
        </div>
      )}

      {empty && state.status === "ready" && (
        <div className="empty">
          <p className="empty__title">还没有作品</p>
          <p className="empty__body">
            {noModels
              ? "还没有可用的服务商。到「设置 → API 设置」填写 API URL 与 Key、添加模型后，这里就能开始生成。"
              : hasRealProvider
                ? "在下方输入一句描述，左侧选好模型后点「生成」。结果会保存到本地作品文件夹。"
                : "在下方输入一句描述，左侧选好模型后点「生成」。当前只有离线假服务，它返回固定的测试图片，不联网。"}
          </p>
        </div>
      )}

      {active.length > 0 && (
        <ol className="active-list" aria-label="进行中的任务">
          {active.map((entry) => (
            <li key={entry.job.id}>
              <ActiveJob event={entry} onCancel={() => void state.cancel(entry.job.id)} />
            </li>
          ))}
        </ol>
      )}

      {timeline.length > 0 && (
        <section className="results" aria-label="生成结果">
          {timeline.map((entry) =>
            entry.job.status === "failed" ? (
              <FailureCard key={entry.job.id} event={entry} onRetry={onRetry} />
            ) : (
              <ResultGroup
                key={entry.job.id}
                event={entry}
                isLatest={entry === latest}
                onOpenAsset={onOpenAsset}
                onRetry={onRetry}
              />
            ),
          )}
        </section>
      )}

      {historyOnly.length > 0 && (
        <section className="results results--history" aria-label="上次会话记住的作品">
          <p className="results__caption">
            以下图片来自上次会话的页面记忆：本地作品数据目前只保存在内存里，重启后任务记录已清空（S4 接入持久化）。
          </p>
          {historyOnly.map((asset) => (
            <figure key={asset.id} className="result-card result-card--memory">
              <button type="button" className="result-card__button" onClick={() => openZoom(asset.previewUrl, asset.prompt)} aria-label={`查看原图：${asset.prompt}`}>
                <img src={asset.previewUrl} alt={`历史作品：${asset.prompt}`} loading="lazy" />
              </button>
              <figcaption>
                <span>{asset.prompt}</span>
                <button type="button" className="button button--tiny" onClick={() => onOpenAsset(asset.id)}>
                  详情
                </button>
              </figcaption>
            </figure>
          ))}
        </section>
      )}
    </section>
  );
}

function ActiveJob({ event, onCancel }: { readonly event: ImageTaskEvent; readonly onCancel: () => void }) {
  const presentation = describeStatus(event.job.status);
  // 多张时上游是一次性返回的，只能给"已等待多久"，不能假装有单张进度。
  const now = useTick(true);
  const startedAt = event.job.startedAt ?? event.job.createdAt;
  const waiting = formatElapsed(now - startedAt);
  return (
    <article className="active-job" aria-busy="true">
      <div className="active-job__body">
        <p className="active-job__title">
          <span className={`status status--${presentation.tone}`}>
            <span aria-hidden="true">{presentation.glyph}</span> {presentation.label}
          </span>
          <span className="active-job__prompt">{event.job.submittedPrompt}</span>
        </p>
        <p className="active-job__meta">
          {event.job.providerDisplayName} · {event.job.modelDisplayName} · {event.job.aspectRatio}
        </p>
        <p className="active-job__wait" aria-live="off">
          已等待 {waiting}
          {event.job.count > 1 ? ` · 预计 ${event.job.count} 张（上游一次性返回，出齐才显示）` : ""}
          {(event.job.partialImages ?? 0) > 0 ? ` · 已收到 ${event.job.partialImages} 张中间图像` : ""}
        </p>
      </div>
      <div className="active-job__progress" role="progressbar" aria-label="生成进度" aria-valuetext={presentation.label}>
        <span />
      </div>
      {cancellable(event) ? (
        <button type="button" className="button button--ghost" onClick={onCancel}>
          停止此任务
        </button>
      ) : (
        <span className="active-job__note">
          {event.job.capabilities.cancel ? "完成前不能停止" : "当前模型不支持取消，结果会在完成后保存"}
        </span>
      )}
    </article>
  );
}

/** 失败卡片：和其它结果同处一条时间线，不再单独堆在顶部。 */
function FailureCard({
  event,
  onRetry,
}: {
  readonly event: ImageTaskEvent;
  readonly onRetry: (jobId: string) => void;
}) {
  return (
    <article className="notice notice--error" role="status" aria-label="生成失败的任务">
      <div className="notice__head">
        <strong>生成失败</strong>
        <button
          type="button"
          className="button button--icon"
          title="重试这次请求"
          aria-label="重试这次请求"
          onClick={() => onRetry(event.job.id)}
        >
          <RetryIcon size={13} />
        </button>
      </div>
      <p className="notice__prompt">{event.job.submittedPrompt}</p>
      <p>{event.job.error?.message ?? "上游返回了未知错误"}</p>
      <p className="notice__meta">
        原始提示词已保留，可修改后重新提交。
        {event.job.error?.retryable ? " 该错误标记为可重试。" : ""}
      </p>
    </article>
  );
}

function ResultGroup({
  event,
  isLatest,
  onOpenAsset,
  onRetry,
}: {
  readonly event: ImageTaskEvent;
  readonly isLatest: boolean;
  readonly onOpenAsset: (assetId: string) => void;
  readonly onRetry: (jobId: string) => void;
}) {
  return (
    <article className="result-group" aria-label="一次生成的结果">
      <header className="result-group__head">
        <p className="result-group__prompt">{event.job.submittedPrompt}</p>
        <div className="result-group__side">
          <p className="result-group__meta">
            {isLatest ? <span className="tag">最新</span> : null}
            {event.job.modelDisplayName} · {event.job.aspectRatio} · {formatDuration(event.job)}
            {event.job.referenceAssetIds.length > 0 ? " · 基于参考图" : ""}
          </p>
          <button
            type="button"
            className="button button--icon"
            title="按同样参数再生成一次"
            aria-label="重试这次请求"
            onClick={() => void onRetry(event.job.id)}
          >
            <RetryIcon size={13} />
          </button>
        </div>
      </header>
      <div className="result-grid" style={{ "--cols": Math.min(event.assets.length, 4) } as CSSProperties}>
        {event.assets.map((asset) => (
          <figure key={asset.id} className="result-card">
            <button
              type="button"
              className="result-card__button"
              onClick={() => openZoom(asset.previewUrl, asset.prompt)}
              aria-label={`查看原图：${asset.prompt}`}
            >
              <img src={asset.previewUrl} alt={asset.prompt} loading="lazy" />
            </button>
            <figcaption>
              <span className="result-card__size">
                {asset.width}×{asset.height}
              </span>
              <span className="result-card__actions">
                <button
                  type="button"
                  className="button button--icon button--tiny"
                  title="在资源管理器中显示"
                  aria-label={`在资源管理器中显示：${asset.prompt}`}
                  onClick={() => void window.appLibrary?.revealAsset(asset.id)}
                >
                  <FolderIcon size={12} />
                </button>
                <button type="button" className="button button--tiny" onClick={() => onOpenAsset(asset.id)}>
                  详情
                </button>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </article>
  );
}

