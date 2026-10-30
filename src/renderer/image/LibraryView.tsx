/**
 * 作品库：已保存到磁盘的全部成图，按时间倒序；以及只存在于页面记忆里的历史缩略。
 *
 * 点任意一张打开详情抽屉。这里不重新请求任何数据，全部来自 main 推送的任务事件。
 */
import { useState } from "react";
import type { ImageAsset } from "../../shared/image-generation.ts";
import type { ImageAgentState } from "./use-image-agent.ts";
import { formatBytes, formatTime } from "../lib/format.ts";
import { TrashIcon } from "../shell/icons.tsx";

interface LibraryViewProps {
  readonly state: ImageAgentState;
  readonly onOpenAsset: (assetId: string) => void;
}

export function LibraryView({ state, onOpenAsset }: LibraryViewProps) {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string>();
  const keyword = query.trim().toLowerCase();

  const allAssets: ImageAsset[] = state.jobs
    .flatMap((entry) => entry.assets)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  const assets =
    keyword === ""
      ? allAssets
      : allAssets.filter((asset) => asset.prompt.toLowerCase().includes(keyword));
  const knownIds = new Set(allAssets.map((asset) => asset.id));
  const historyOnly = state.remembered.filter((asset) => !knownIds.has(asset.id));
  const providers = new Map(state.models.map((model) => [model.id, model.displayName.split(" · ")[0] ?? model.id]));

  /** 删除是真删文件，先确认一次。 */
  async function removeAsset(asset: ImageAsset): Promise<void> {
    const confirmed = window.confirm(`删除这张作品？图片文件也会一起删除，无法撤销。\n\n${asset.prompt}`);
    if (!confirmed) return;
    const result = await window.appLibrary?.deleteAsset(asset.id);
    if (result?.ok) {
      setNotice(`已删除作品（${asset.width}×${asset.height}）。`);
      window.dispatchEvent(new Event("image-agent:data-changed"));
    } else {
      setNotice(`删除失败：${result?.message ?? "未知错误"}`);
    }
  }

  return (
    <section className="page" aria-labelledby="library-title">
      <header className="page__head">
        <h2 id="library-title">作品库</h2>
        <span className="page__meta">
          {assets.length} 张作品（已保存到本地文件夹）
          {keyword !== "" ? ` · 已按「${query.trim()}」筛选（共 ${allAssets.length} 张）` : ""}
          {historyOnly.length > 0 ? ` · ${historyOnly.length} 张历史记忆` : ""}
        </span>
        <input
          className="field__input library-search"
          type="search"
          value={query}
          placeholder="按提示词筛选…"
          aria-label="按提示词筛选作品"
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>

      {notice !== undefined && (
        <p className="settings__notice settings__notice--info" role="status">
          {notice}
        </p>
      )}

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
              <li key={asset.id} className="library-item">
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
                <button
                  type="button"
                  className="library-item__delete"
                  aria-label={`删除作品：${asset.prompt}`}
                  title="删除这张作品（连同本地文件）"
                  onClick={() => void removeAsset(asset)}
                >
                  <TrashIcon size={12} />
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
