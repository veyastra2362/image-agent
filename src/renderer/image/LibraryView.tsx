/**
 * 作品库：本会话生成过的全部成图，按时间倒序；以及只存在于页面记忆里的历史缩略。
 *
 * 点任意一张打开详情抽屉。这里不重新请求任何数据，全部来自 main 推送的任务事件。
 */
import type { ImageAsset, ProviderRef } from "../../shared/image-generation.ts";
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

interface ProviderViewProps {
  readonly models: readonly ProviderRef[];
  readonly state: ImageAgentState;
}

/** 服务商页：每个模型实际声明了什么能力，用明文列出来，不让人猜。 */
export function ProviderView({ models, state }: ProviderViewProps) {
  const grouped = new Map<string, ProviderRef[]>();
  for (const model of models) {
    const list = grouped.get(model.id) ?? [];
    list.push(model);
    grouped.set(model.id, list);
  }

  return (
    <section className="page" aria-labelledby="providers-title">
      <header className="page__head">
        <h2 id="providers-title">服务商</h2>
        <span className="page__meta">
          {grouped.size} 个服务 · {models.length} 个模型
        </span>
      </header>

      {models.length === 0 ? (
        <div className="empty">
          <p className="empty__title">没有可用的服务</p>
          <p className="empty__body">主进程还在加载，或在「设置 → API 设置」里配置密钥后重启应用。</p>
        </div>
      ) : (
        [...grouped.entries()].map(([providerId, list]) => (
          <article key={providerId} className="provider-card">
            <header className="provider-card__head">
              <h3>{list[0]?.displayName.split(" · ")[0] ?? providerId}</h3>
              <span className="provider-card__id">{providerId}</span>
            </header>
            <p className="field__hint">
              {list[0]?.uploadsUserAssets
                ? "参考图会上传到该服务商。"
                : "该服务商不会收到你的参考图（当前模型也不支持参考图）。"}
            </p>
            <ul className="provider-models">
              {list.map((model) => {
                const caps = model.capabilities;
                return (
                  <li key={`${model.id}:${model.model}`}>
                    <div className="provider-models__head">
                      <strong>{model.displayName.split(" · ")[1] ?? model.model}</strong>
                      {model.default && <span className="badge badge--ok">默认</span>}
                    </div>
                    <dl className="facts">
                      <div className="fact">
                        <dt>能力</dt>
                        <dd>
                          {[
                            caps.textToImage ? "文生图" : "",
                            caps.imageToImage ? `参考图（≤${caps.referenceImageLimit}）` : "不支持参考图",
                            caps.seed ? "可固定 seed" : "无 seed",
                            caps.negativePrompt ? "支持负面词" : "无负面词",
                            caps.async ? "异步任务" : "同步返回",
                            caps.cancel ? "可取消" : "不可取消",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </dd>
                      </div>
                      <div className="fact">
                        <dt>尺寸</dt>
                        <dd>
                          {caps.autoSize ? "支持自动" : "需指定比例"} ·{" "}
                          {caps.customSize ? "支持自定义宽高" : "固定尺寸"} ·{" "}
                          {caps.sizes.length > 0 ? caps.sizes.join("、") : caps.aspectRatios.join("、")}
                        </dd>
                      </div>
                      <div className="fact">
                        <dt>输出格式</dt>
                        <dd>{caps.transcode ? "PNG / JPEG / WebP" : "仅 PNG"}</dd>
                      </div>

                    </dl>
                  </li>
                );
              })}
            </ul>
          </article>
        ))
      )}

    </section>
  );
}
