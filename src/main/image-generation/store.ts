/**
 * 任务与作品存储。
 *
 * `saveAsset` 接收原始字节并返回"落库后"的 asset：内存实现会补上 data URL 预览，
 * 磁盘实现（library-store.ts）会把图片写进用户目录并返回指向该文件的 URL。
 * service 必须使用返回值，因为只有存储知道最终预览地址。
 */
import type { ImageAsset, ImageJob, ImageTaskEvent } from "@shared/image-generation";

export interface JobStore {
  saveJob(job: ImageJob): void;
  getJob(id: string): ImageJob | undefined;
  findJobByRequestId(requestId: string): ImageJob | undefined;
  listJobs(): readonly ImageJob[];
  listActiveJobs(): readonly ImageJob[];

  saveAsset(asset: ImageAsset, bytes?: Uint8Array): ImageAsset;
  getAsset(id: string): ImageAsset | undefined;
  hasAsset(id: string): boolean;
  /** 参考图要原样发给上游，这里把字节读回来。 */
  bytesForAsset(id: string): Uint8Array | undefined;
  listAssetsForJob(jobId: string): readonly ImageAsset[];
}

/** 离线测试用：不落盘，资产以 data URL 保存在内存里。 */
export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, ImageJob>();
  private readonly requestIds = new Map<string, string>();
  private readonly assets = new Map<string, ImageAsset>();

  saveJob(job: ImageJob): void {
    this.jobs.set(job.id, job);
    this.requestIds.set(job.requestId, job.id);
  }

  getJob(id: string): ImageJob | undefined {
    return this.jobs.get(id);
  }

  findJobByRequestId(requestId: string): ImageJob | undefined {
    const id = this.requestIds.get(requestId);
    return id === undefined ? undefined : this.jobs.get(id);
  }

  listJobs(): readonly ImageJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  listActiveJobs(): readonly ImageJob[] {
    return [...this.jobs.values()].filter(
      (job) => job.status === "queued" || job.status === "submitting" || job.status === "running",
    );
  }

  saveAsset(asset: ImageAsset, bytes?: Uint8Array): ImageAsset {
    if (this.assets.has(asset.id)) throw new Error(`asset ${asset.id} 已存在`);
    const stored =
      bytes === undefined
        ? asset
        : { ...asset, previewUrl: `data:${asset.mimeType};base64,${Buffer.from(bytes).toString("base64")}` };
    this.assets.set(asset.id, stored);
    return stored;
  }

  getAsset(id: string): ImageAsset | undefined {
    return this.assets.get(id);
  }

  hasAsset(id: string): boolean {
    return this.assets.has(id);
  }

  bytesForAsset(id: string): Uint8Array | undefined {
    const asset = this.assets.get(id);
    if (asset === undefined) return undefined;
    const match = /^data:([^;]+);base64,(.*)$/.exec(asset.previewUrl);
    return match?.[2] === undefined ? undefined : Buffer.from(match[2], "base64");
  }

  listAssetsForJob(jobId: string): readonly ImageAsset[] {
    return [...this.assets.values()]
      .filter((asset) => asset.jobId === jobId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}

export function toTaskEvent(job: ImageJob, store: JobStore): ImageTaskEvent {
  return { job, assets: store.listAssetsForJob(job.id) };
}
