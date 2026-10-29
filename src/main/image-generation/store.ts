/**
 * 会话内的任务与作品存储。
 *
 * S1 只要求"无网络跑通完整生成流程"，因此这里是内存实现：不写数据库、不写磁盘，
 * 重启后任务与作品清空。持久化落盘由 S4 替换本模块的实现，接口保持不变。
 */
import type { ImageAsset, ImageJob, ImageTaskEvent } from "@shared/image-generation";

export interface JobStore {
  saveJob(job: ImageJob): void;
  getJob(id: string): ImageJob | undefined;
  findJobByRequestId(requestId: string): ImageJob | undefined;
  listJobs(): readonly ImageJob[];
  listActiveJobs(): readonly ImageJob[];

  saveAsset(asset: ImageAsset): void;
  getAsset(id: string): ImageAsset | undefined;
  hasAsset(id: string): boolean;
  listAssetsForJob(jobId: string): readonly ImageAsset[];

  addCost(amount: number): void;
  spent(): number;
}

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, ImageJob>();
  private readonly requestIds = new Map<string, string>();
  private readonly assets = new Map<string, ImageAsset>();
  private cost = 0;

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

  saveAsset(asset: ImageAsset): void {
    if (this.assets.has(asset.id)) throw new Error(`asset ${asset.id} 已存在`);
    this.assets.set(asset.id, asset);
  }

  getAsset(id: string): ImageAsset | undefined {
    return this.assets.get(id);
  }

  hasAsset(id: string): boolean {
    return this.assets.has(id);
  }

  listAssetsForJob(jobId: string): readonly ImageAsset[] {
    return [...this.assets.values()]
      .filter((asset) => asset.jobId === jobId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  addCost(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("费用必须是有限非负数");
    this.cost += amount;
  }

  spent(): number {
    return this.cost;
  }
}

export function toTaskEvent(job: ImageJob, store: JobStore): ImageTaskEvent {
  return { job, assets: store.listAssetsForJob(job.id) };
}
