/**
 * 作品库：已保存到磁盘的全部成图，按时间倒序；以及只存在于页面记忆里的历史缩略。
 *
 * 点任意一张打开详情抽屉。这里不重新请求任何数据，全部来自 main 推送的任务事件。
 */
import type { ImageAsset } from "../../shared/image-generation.ts";
import type { ImageAgentState } from "./use-image-agent.ts";
import { formatBytes, formatTime } from "../lib/format.ts";

interface LibraryViewProps {
  readonly state: ImageAgentState;
  readonly onOpenAsset: (assetId: string) => void;
}

export function LibraryView({ state, onOpenAsset }: LibraryViewProps) {
  const assets: ImageAsset[] = state.jobs
    .flatMap((entry) => entry.assets)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  const knownIds = new Set(assets.map((asset) => asset.id));
  const historyOnly = state.remembered.filter((asset) => !knownIds.has(asset.id));
  const providers = new Map(state.models.map((model) => [model.id, model.displayName.split(" · ")[0] ?? model.id]));

  return (
    <section className="page" aria-labelledby="library-title">
      <header className="page__head">
        <h2 id="library-title">作品库</h2>
        <span className="page__meta">
          {assets.length} 张作品（已保存到本地文件夹）
          {historyOnly.length > 0 ? ` · ${historyOnly.length} 张历史记忆` : ""}
        </span>
      </header>

      {assets.length === 0 && historyOnly.length === 0 ? (
        <div className="empty">
          <p className="empty__title">作品库是空的</p>
          <p className="empty__body">回到「创作」生成第一张图，成功后会自动出现在这里。</p>
        </div>
      ) : (
        <ul className="library-grid">
          {assets.map((asset) => {
            const job = state.jobs.find((entry) => entry.job.id === asset.jobId)?.job;
            return (
              <li key={asset.id}>
                <button type="button" className="library-card" onClick={() => onOpenAsset(asset.id)}>
                  <img src={asset.previewUrl} alt={asset.prompt} loading="lazy" />
                  <span className="library-card__meta">
                    <span className="library-card__prompt">{asset.prompt}</span>
                    <span className="library-card__facts">
                      {asset.width}×{asset.height} · {formatBytes(asset.byteLength)} ·{" "}
                      {providers.get(asset.providerId) ?? asset.providerId}
                    </span>
                    <span className="library-card__facts">{formatTime(asset.createdAt)}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {historyOnly.map((asset) => (
            <li key={asset.id}>
              <button type="button" className="library-card library-card--memory" onClick={() => onOpenAsset(asset.id)}>
                <img src={asset.previewUrl} alt={asset.prompt} loading="lazy" />
                <span className="library-card__meta">
                  <span className="library-card__prompt">{asset.prompt}</span>
                  <span className="library-card__facts">
                    {asset.width}×{asset.height} · 上次会话的页面记忆
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
