/**
 * 作品库：先按"相册"分组浏览，再进相册看具体作品。
 *
 * 相册顺序：我的收藏 → 各服务商（按服务商 id 首次出现顺序）。
 * 封面用该相册里**最后加入**的一张图；点相册进二级列表。
 * 收藏标记存在 main（userData/favorites.json），重启和索引重建都不会丢。
 */
import { useEffect, useMemo, useState } from "react";
import type { ImageAsset } from "../../shared/image-generation.ts";
import type { ImageAgentState } from "./use-image-agent.ts";
import { formatBytes, formatTime } from "../lib/format.ts";
import { HeartIcon, TrashIcon } from "../shell/icons.tsx";
import { Select } from "../shell/Select.tsx";

interface LibraryViewProps {
  readonly state: ImageAgentState;
  readonly onOpenAsset: (assetId: string) => void;
}

const FAVORITES_ALBUM = "__favorites__";

export function LibraryView({ state, onOpenAsset }: LibraryViewProps) {
  const [album, setAlbum] = useState<string>();
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<"all" | "today" | "7d" | "30d">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "largest">("newest");
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    void window.appLibrary
      ?.favorites()
      .then((ids) => setFavorites(new Set(ids)))
      .catch(() => undefined);
  }, []);

  const providers = useMemo(
    () => new Map(state.models.map((model) => [model.id, model.displayName.split(" · ")[0] ?? model.id])),
    [state.models],
  );
  const providerName = (id: string): string => providers.get(id) ?? id;

  const assets: ImageAsset[] = state.jobs
    .flatMap((entry) => entry.assets)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  const knownIds = new Set(assets.map((asset) => asset.id));
  const historyOnly = state.remembered.filter((asset) => !knownIds.has(asset.id));

  /** 相册：收藏在前，其余按服务商第一次出图的时间排序。 */
  const albums = useMemo(() => {
    const byProvider = new Map<string, ImageAsset[]>();
    for (const asset of assets) {
      const list = byProvider.get(asset.providerId);
      if (list === undefined) byProvider.set(asset.providerId, [asset]);
      else list.push(asset);
    }
    return [
      {
        id: FAVORITES_ALBUM,
        title: "我的收藏",
        count: assets.filter((asset) => favorites.has(asset.id)).length,
        cover: assets.find((asset) => favorites.has(asset.id)),
      },
      ...[...byProvider.entries()].map(([providerId, items]) => ({
        id: providerId,
        title: providerName(providerId),
        count: items.length,
        cover: items[0],
      })),
    ];
  }, [assets, favorites, providers]);

  const keyword = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const inAlbum =
      album === undefined
        ? []
        : album === FAVORITES_ALBUM
          ? assets.filter((asset) => favorites.has(asset.id))
          : assets.filter((asset) => asset.providerId === album);

    const since = rangeStart(range);
    const inRange = since === undefined ? inAlbum : inAlbum.filter((asset) => asset.createdAt >= since);
    const filtered = keyword === "" ? inRange : inRange.filter((asset) => asset.prompt.toLowerCase().includes(keyword));
    return sortAssets(filtered, sort);
  }, [album, assets, favorites, keyword, range, sort]);

  async function toggleFavorite(asset: ImageAsset): Promise<void> {
    const result = await window.appLibrary?.toggleFavorite(asset.id);
    if (result === undefined) return;
    setFavorites((current) => {
      const next = new Set(current);
      if (result.favorite) next.add(asset.id);
      else next.delete(asset.id);
      return next;
    });
  }

  async function removeAsset(asset: ImageAsset): Promise<void> {
    const confirmed = window.confirm(`删除这张作品？图片文件也会一起删除，无法撤销。\n\n${asset.prompt}`);
    if (!confirmed) return;
    const result = await window.appLibrary?.deleteAsset(asset.id);
    if (result?.ok) {
      setNotice(`已删除作品（${asset.width}×${asset.height}）。`);
      setFavorites((current) => {
        const next = new Set(current);
        next.delete(asset.id);
        return next;
      });
      window.dispatchEvent(new Event("image-agent:data-changed"));
    } else {
      setNotice(`删除失败：${result?.message ?? "未知错误"}`);
    }
  }

  const activeAlbum = albums.find((entry) => entry.id === album);

  return (
    <section className="page" aria-labelledby="library-title">
      <header className="page__head">
        <h2 id="library-title" className="page__title-row">
          {album !== undefined && (
            <button
              type="button"
              className="button button--icon"
              aria-label="返回相册列表"
              title="返回相册列表"
              onClick={() => {
                setAlbum(undefined);
                setQuery("");
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path
                  d="M10 3 5 8l5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          {album === undefined ? "作品库" : (activeAlbum?.title ?? "作品库")}
        </h2>
        <span className="page__meta">
          {album === undefined
            ? `${assets.length} 张作品 · ${Math.max(0, albums.length - 1)} 个服务商相册`
            : `${visible.length} 张${keyword === "" ? "" : `（按「${query.trim()}」筛选）`}`}
          {historyOnly.length > 0 && album === undefined ? ` · ${historyOnly.length} 张历史记忆` : ""}
        </span>
        {album !== undefined && (
          <div className="library-filters">
            <Select
              ariaLabel="排序方式"
              value={sort}
              onChange={(next) => setSort(next as "newest" | "oldest" | "largest")}
              options={[
                { value: "newest", label: "最新优先" },
                { value: "oldest", label: "最早优先" },
                { value: "largest", label: "文件最大" },
              ]}
            />
            <Select
              ariaLabel="按加入时间筛选"
              value={range}
              onChange={(next) => setRange(next as "all" | "today" | "7d" | "30d")}
              options={[
                { value: "all", label: "全部时间" },
                { value: "today", label: "今天" },
                { value: "7d", label: "最近 7 天" },
                { value: "30d", label: "最近 30 天" },
              ]}
            />
            <input
              className="field__input library-search"
              type="search"
              value={query}
              placeholder="按提示词筛选…"
              aria-label="按提示词筛选作品"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}
      </header>

      {notice !== undefined && (
        <p className="settings__notice settings__notice--info" role="status">
          {notice}
        </p>
      )}

      {album === undefined ? (
        assets.length === 0 && historyOnly.length === 0 ? (
          <div className="empty">
            <p className="empty__title">作品库是空的</p>
            <p className="empty__body">回到「创作」生成第一张图，成功后会自动出现在这里。</p>
          </div>
        ) : (
          <ul className="album-grid">
            {albums.map((entry) => (
              <li key={entry.id}>
                <button type="button" className="album-card" onClick={() => setAlbum(entry.id)}>
                  <span className="album-card__cover">
                    {entry.cover !== undefined ? (
                      <img src={entry.cover.previewUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="album-card__placeholder">
                        {entry.id === FAVORITES_ALBUM ? <HeartIcon size={22} /> : "空"}
                      </span>
                    )}
                  </span>
                  <span className="album-card__title">{entry.title}</span>
                  <span className="album-card__count">{entry.count} 张</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : visible.length === 0 ? (
        <div className="empty">
          <p className="empty__title">{keyword === "" ? "这个相册还没有作品" : "没有符合条件的作品"}</p>
          <p className="empty__body">
            {album === FAVORITES_ALBUM ? "在作品右上角点爱心即可收藏。" : "换一个关键词，或回到相册列表。"}
          </p>
        </div>
      ) : (
        <ul className="library-grid">
          {visible.map((asset) => {
            const isFav = favorites.has(asset.id);
            return (
              <li key={asset.id} className="library-item">
                <button
                  type="button"
                  className="library-item__open"
                  onClick={() => onOpenAsset(asset.id)}
                  aria-label={`打开作品：${asset.prompt}`}
                >
                  <img src={asset.previewUrl} alt={asset.prompt} loading="lazy" />
                </button>
                <button
                  type="button"
                  className={`library-item__fav ${isFav ? "is-on" : ""}`}
                  aria-pressed={isFav}
                  aria-label={isFav ? "取消收藏" : "收藏这张作品"}
                  title={isFav ? "取消收藏" : "收藏"}
                  onClick={() => void toggleFavorite(asset)}
                >
                  <HeartIcon size={13} filled={isFav} />
                </button>
                <div className="library-item__meta">
                  <span className="library-card__prompt">{asset.prompt}</span>
                  <span className="library-card__facts">
                    {asset.width}×{asset.height} · {formatBytes(asset.byteLength)} · {providerName(asset.providerId)}
                  </span>
                  <span className="library-item__row">
                    <span className="library-card__facts">{formatTime(asset.createdAt)}</span>
                    <button
                      type="button"
                      className="library-item__delete"
                      aria-label={`删除作品：${asset.prompt}`}
                      title="删除这张作品（连同本地文件）"
                      onClick={() => void removeAsset(asset)}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 排序：不改变筛选结果，只决定展示顺序。 */
function sortAssets(assets: readonly ImageAsset[], sort: "newest" | "oldest" | "largest"): ImageAsset[] {
  const list = [...assets];
  if (sort === "newest") list.sort((a, b) => b.createdAt - a.createdAt);
  else if (sort === "oldest") list.sort((a, b) => a.createdAt - b.createdAt);
  else list.sort((a, b) => b.byteLength - a.byteLength);
  return list;
}

/** 时间筛选的起点；"全部"返回 undefined。按本地自然日算，不是"最近 24 小时"。 */
function rangeStart(range: "all" | "today" | "7d" | "30d"): number | undefined {
  if (range === "all") return undefined;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "today") return start.getTime();
  const days = range === "7d" ? 6 : 29;
  start.setDate(start.getDate() - days);
  return start.getTime();
}
