/**
 * 全局任务栏：多任务排队、成功/失败、详情入口。
 * 切换页面或继续创作时任务状态始终可见。
 */
import type { ImageTaskEvent } from "../../shared/image-generation.ts";
import { formatTime } from "../lib/format.ts";
import { describeStatus } from "../lib/job-status.ts";
import { cancellable, type ImageAgentState } from "./use-image-agent.ts";

interface JobListProps {
  readonly state: ImageAgentState;
  readonly onOpenAsset: (assetId: string) => void;
}

export function JobList({ state, onOpenAsset }: JobListProps) {
  return (
    <section className="joblist" aria-labelledby="joblist-title">
      <header className="joblist__head">
        <h2 id="joblist-title">任务</h2>
        <span className="joblist__count">{state.jobs.length}</span>
      </header>
      {state.jobs.length === 0 ? (
        <p className="joblist__empty">提交后会在这里看到进度。</p>
      ) : (
        <ul>
          {state.jobs.map((entry) => (
            <JobRow
              key={entry.job.id}
              event={entry}
              onOpen={() => {
                const assetId = entry.assets[0]?.id;
                if (assetId) onOpenAsset(assetId);
              }}
              onCancel={() => void state.cancel(entry.job.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function JobRow({
  event,
  onOpen,
  onCancel,
}: {
  readonly event: ImageTaskEvent;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
}) {
  const presentation = describeStatus(event.job.status);
  const first = event.assets[0];
  return (
    <li className="job-row">
      {first ? (
        <button type="button" className="job-row__thumb" onClick={onOpen} aria-label="打开作品">
          <img src={first.previewUrl} alt="" loading="lazy" />
        </button>
      ) : (
        <span className={`job-row__thumb job-row__thumb--empty status--${presentation.tone}`} aria-hidden="true">
          {presentation.glyph}
        </span>
      )}
      <div className="job-row__main">
        <p className="job-row__prompt">{event.job.submittedPrompt}</p>
        <p className="job-row__meta">
          <span className={`status status--${presentation.tone}`}>{presentation.label}</span>
          <span>
            {event.job.modelDisplayName} · {formatTime(event.job.updatedAt)}
          </span>
        </p>
        {event.job.error && <p className="job-row__error">{event.job.error.message}</p>}
      </div>
      {cancellable(event) && (
        <button type="button" className="button button--tiny" onClick={onCancel} aria-label="停止此任务">
          停止
        </button>
      )}
    </li>
  );
}
