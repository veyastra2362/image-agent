/**
 * 会话内的作品记忆（仅 renderer localStorage）。
 *
 * main 目前是内存作品库，重启后 asset ID 失效。这里只记住"渲染预览"和"父图参考"两类
 * 界面数据，并在重新打开时丢弃任何引用不到资产的记忆，避免 UI 展示一个已经消失的作品。
 * 持久化作品库（S4）接入后，这里应改为只做缓存。
 */
import type { ImageTaskEvent } from "../../shared/image-generation.ts";

const STORAGE_KEY = "image-agent.renderer-library-memory.v1";
const MAX_REMEMBERED_ASSETS = 24;

export interface RememberedAsset {
  readonly id: string;
  readonly jobId: string;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
  readonly prompt: string;
  readonly parentAssetId?: string;
  readonly createdAt: number;
}

interface Persisted {
  readonly version: 1;
  readonly assets: readonly RememberedAsset[];
}

export function loadRememberedAssets(knownAssetIds: ReadonlySet<string>): RememberedAsset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed?.version !== 1 || !Array.isArray(parsed.assets)) return [];
    return parsed.assets.filter(
      (asset) =>
        typeof asset?.id === "string" &&
        typeof asset.previewUrl === "string" &&
        asset.previewUrl.startsWith("data:image/png;base64,") &&
        knownAssetIds.has(asset.id),
    );
  } catch {
    // 记忆损坏不影响主流程：丢弃即可。
    return [];
  }
}

/** 把本次事件中的作品合并进"受支持"集合：已有记录保留其父图关系。 */
export function mergeRememberedAssets(
  previous: readonly RememberedAsset[],
  event: ImageTaskEvent,
): RememberedAsset[] {
  const existing = new Map(previous.map((asset) => [asset.id, asset]));
  const parentAssetId = event.job.referenceAssetIds.find((id) => existing.has(id));
  const added = event.assets.map((asset) => {
    const kept = existing.get(asset.id);
    if (kept) return kept;
    return {
      id: asset.id,
      jobId: asset.jobId,
      previewUrl: asset.previewUrl,
      width: asset.width,
      height: asset.height,
      prompt: asset.prompt,
      ...(parentAssetId === undefined ? {} : { parentAssetId }),
      createdAt: asset.createdAt,
    };
  });
  const merged = [...added, ...previous];
  const seen = new Set<string>();
  return merged
    .filter((asset) => {
      if (seen.has(asset.id)) return false;
      seen.add(asset.id);
      return true;
    })
    .slice(0, MAX_REMEMBERED_ASSETS);
}

export function saveRememberedAssets(assets: readonly RememberedAsset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, assets } satisfies Persisted));
  } catch {
    // 存储满或被禁用时静默降级为仅本次会话可见。
  }
}
