/**
 * 结果画布：运行中的任务卡片 + 已完成作品的网格。
 *
 * 空态不是控制台：一张图都没有时说明下一步；有任务时优先展示进行中的进度和取消入口。
 */
import type { CSSProperties } from "react";
import type { ImageTaskEvent } from "../../shared/image-generation.ts";
import { formatDuration } from "../lib/format.ts";
import { describeStatus } from "../lib/job-status.ts";
import { cancellable, latestSucceededJob, type ImageAgentState } from "./use-image-agent.ts";

interface ResultCanvasProps {
  readonly state: ImageAgentState;
  readonly onOpenAsset: (assetId: string) => void;
}

export function ResultCanvas({ state, onOpenAsset }: ResultCanvasProps) {
  const active = state.jobs.filter((entry) => describeStatus(entry.job.status).active);
  const completed = state.jobs.filter((entry) => entry.job.status === "succeeded" && entry.assets.length > 0);
  const problems = state.jobs.filter((entry) => entry.job.status === "failed");

  const latest = latestSucceededJob(state.jobs);
  const knownIds = new Set(state.jobs.flatMap((entry) => entry.assets.map((asset) => asset.id)));
  const historyOnly = state.remembered.filter((asset) => !knownIds.has(asset.id));

  const empty = active.length === 0 && completed.length === 0 && historyOnly.length === 0 && problems.length === 0;

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
            在下方输入一句描述，左侧选好模型后点「生成」。当前只有离线假服务，它返回固定的测试图片，不联网。
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

      {problems.length > 0 && (
        <section className="failures" aria-label="失败的任务">
          {problems.map((entry) => (
            <div key={entry.job.id} className="notice notice--error" role="status">
              <strong>生成失败</strong>
              <p>{entry.job.error?.message ?? "上游返回了未知错误"}</p>
              <p className="notice__meta">
                原始提示词已保留，可修改后重新提交。
                {entry.job.error?.retryable ? " 该错误标记为可重试。" : ""}
              </p>
            </div>
          ))}
        </section>
      )}

      {completed.length > 0 && (
        <section className="results" aria-label="已完成作品">
          {completed.map((entry) => (
            <ResultGroup
              key={entry.job.id}
              event={entry}
              isLatest={entry === latest}
              onOpenAsset={onOpenAsset}
            />
          ))}
        </section>
      )}

      {historyOnly.length > 0 && (
        <section className="results results--history" aria-label="上次会话记住的作品">
          <p className="results__caption">
            以下图片来自上次会话的页面记忆：本地作品数据目前只保存在内存里，重启后任务记录已清空（S4 接入持久化）。
          </p>
          {historyOnly.map((asset) => (
            <figure key={asset.id} className="result-card result-card--memory">
              <button type="button" className="result-card__button" onClick={() => onOpenAsset(asset.id)}>
                <img src={asset.previewUrl} alt={`历史作品：${asset.prompt}`} loading="lazy" />
              </button>
              <figcaption>{asset.prompt}</figcaption>
            </figure>
          ))}
        </section>
      )}
    </section>
  );
}

function ActiveJob({ event, onCancel }: { readonly event: ImageTaskEvent; readonly onCancel: () => void }) {
  const presentation = describeStatus(event.job.status);
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
          {event.job.providerDisplayName} · {event.job.modelDisplayName} · {event.job.count} 张 ·{" "}
          {event.job.aspectRatio}
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

function ResultGroup({
  event,
  isLatest,
  onOpenAsset,
}: {
  readonly event: ImageTaskEvent;
  readonly isLatest: boolean;
  readonly onOpenAsset: (assetId: string) => void;
}) {
  return (
    <article className="result-group" aria-label="一次生成的结果">
      <header className="result-group__head">
        <p className="result-group__prompt">{event.job.submittedPrompt}</p>
        <p className="result-group__meta">
          {isLatest ? <span className="tag">最新</span> : null}
          {event.job.modelDisplayName} · {event.job.aspectRatio} · {formatDuration(event.job)}
          {event.job.referenceAssetIds.length > 0 ? " · 基于参考图" : ""}
        </p>
      </header>
      <div className="result-grid" style={{ "--cols": Math.min(event.assets.length, 4) } as CSSProperties}>
        {event.assets.map((asset) => (
          <figure key={asset.id} className="result-card">
            <button
              type="button"
              className="result-card__button"
              onClick={() => onOpenAsset(asset.id)}
              aria-label={`查看大图：${asset.prompt}`}
            >
              <img src={asset.previewUrl} alt={asset.prompt} loading="lazy" />
            </button>
            <figcaption>
              {asset.width}×{asset.height}
            </figcaption>
          </figure>
        ))}
      </div>
    </article>
  );
}


