/**
 * 磁盘作品库：任务索引写在 userData，图片写在用户选的文件夹。
 *
 * 几个刻意的取舍：
 *  1. 索引与图片分开：换目录不会让旧作品消失（每个 asset 记录自己的绝对路径）。
 *  2. 写盘失败不会让生成失败：图片已经在内存里能看，只是提示"没能保存"。
 *  3. 启动时任何"没结束"的任务都被标成失败并写清原因，而不是假装还在跑。
 *  4. 索引损坏时退回空库并备份原文件，不让应用打不开。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ImageAsset, ImageJob } from "@shared/image-generation";
import {
  LIBRARY_ASSET_SUBDIR,
  assetFileName,
  isAbsoluteDirectory,
  normalizeLibraryDir,
  type LibrarySettings,
  type LibraryStats,
} from "@shared/library";
import { readImageSize } from "./image-size";
import type { JobStore } from "./image-generation/store";

const INDEX_VERSION = 1;

interface IndexedAsset extends ImageAsset {
  /** 绝对路径；缺失说明文件已不在，加载时丢弃。 */
  readonly file?: string;
}

interface IndexFile {
  readonly version: number;
  readonly jobs: readonly ImageJob[];
  readonly assets: readonly IndexedAsset[];
}

export interface FileJobStoreOptions {
  /** 索引文件所在目录（userData）。 */
  readonly indexDir: string;
  /** 图片目录；留空表示还没确定。 */
  readonly dir?: string;
  /** 测试注入。 */
  readonly readFile?: (file: string) => string;
  readonly writeFile?: (file: string, data: Uint8Array | string) => void;
  readonly exists?: (file: string) => boolean;
  readonly mkdir?: (dir: string) => void;
  readonly rename?: (from: string, to: string) => void;
  readonly copy?: (from: string, to: string) => void;
}

export class FileJobStore implements JobStore {
  readonly #indexDir: string;
  readonly #readFile: (file: string) => string;
  readonly #writeFile: (file: string, data: Uint8Array | string) => void;
  readonly #exists: (file: string) => boolean;
  readonly #mkdir: (dir: string) => void;
  readonly #rename: (from: string, to: string) => void;
  readonly #copy: (from: string, to: string) => void;

  #dir: string;
  readonly #jobs = new Map<string, ImageJob>();
  readonly #requestIds = new Map<string, string>();
  readonly #assets = new Map<string, ImageAsset>();
  /** assetId → 绝对文件路径。内存里的 previewUrl 靠它拼 ia-asset://。 */
  readonly #files = new Map<string, string>();
  #loadWarning: string | undefined;
  /** 保存失败时只提示一次，避免刷屏。 */
  #saveErrorNotified = false;

  constructor(options: FileJobStoreOptions) {
    this.#indexDir = options.indexDir;
    this.#dir = options.dir ?? "";
    this.#readFile = options.readFile ?? ((file) => readFileSync(file, "utf8"));
    this.#writeFile = options.writeFile ?? ((file, data) => writeFileSync(file, data));
    this.#exists = options.exists ?? existsSync;
    this.#mkdir = options.mkdir ?? ((dir) => void mkdirSync(dir, { recursive: true }));
    this.#rename = options.rename ?? ((from, to) => renameSync(from, to));
    this.#copy = options.copy ?? ((from, to) => copyFileSync(from, to));
  }

  get indexFile(): string {
    return path.join(this.#indexDir, "library.json");
  }

  get dir(): string {
    return this.#dir;
  }

  get loadWarning(): string | undefined {
    return this.#loadWarning;
  }

  /** 换图片目录。旧作品保留原路径，新作品写到新目录。 */
  setDir(dir: string): void {
    if (!isAbsoluteDirectory(dir)) throw new Error("作品目录必须是绝对路径");
    this.#dir = normalizeLibraryDir(dir);
  }

  /** 从索引恢复。文件缺失的作品会被丢弃并记一条警告。 */
  load(): void {
    let raw: string;
    try {
      raw = this.#readFile(this.indexFile);
    } catch {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.#loadWarning = "library.json 不是合法 JSON，已忽略（原文件保留）";
      try {
        this.#writeFile(`${this.indexFile}.broken`, raw);
      } catch {
        // 备份失败不影响继续启动。
      }
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;

    const index = parsed as Partial<IndexFile>;
    const jobs = Array.isArray(index.jobs) ? index.jobs : [];
    const assets = Array.isArray(index.assets) ? index.assets : [];

    let missing = 0;
    const keptAssetIds = new Set<string>();
    for (const asset of assets) {
      if (typeof asset?.id !== "string") continue;
      const file = typeof asset.file === "string" && isAbsoluteDirectory(asset.file) ? asset.file : undefined;
      if (file === undefined || !this.#exists(file)) {
        missing += 1;
        continue;
      }
      const restored: IndexedAsset = { ...asset };
      delete (restored as { file?: string }).file;
      this.#assets.set(asset.id, restored);
      this.#files.set(asset.id, file);
      keptAssetIds.add(asset.id);
    }

    for (const job of jobs) {
      if (typeof job?.id !== "string") continue;
      const assetIds = Array.isArray(job.assetIds) ? job.assetIds.filter((id: string) => keptAssetIds.has(id)) : [];
      // 启动时还在跑的任务不可能再回来：明确标成失败，别让界面一直转圈。
      const interrupted = job.status === "queued" || job.status === "submitting" || job.status === "running";
      const restored: ImageJob = {
        ...job,
        assetIds,
        ...(interrupted
          ? {
              status: "failed" as const,
              finishedAt: job.updatedAt,
              error: {
                code: "internal" as const,
                message: "应用重启，任务已中断（没有继续向服务商发请求）",
                retryable: true,
              },
            }
          : {}),
      };
      this.#jobs.set(restored.id, restored);
      this.#requestIds.set(restored.requestId, restored.id);
    }

    if (missing > 0) {
      this.#loadWarning = `有 ${missing} 张作品的文件已不存在，已从作品库移除`;
    }
  }

  /** 索引里每个 asset → 文件路径；协议处理器用它服务 ia-asset:// 请求。 */
  fileForAsset(assetId: string): string | undefined {
    return this.#files.get(assetId);
  }

  stats(): LibraryStats {
    let bytes = 0;
    for (const asset of this.#assets.values()) bytes += asset.byteLength;
    return { jobs: this.#jobs.size, assets: this.#assets.size, bytes };
  }

  takeSaveError(): boolean {
    if (!this.#saveErrorNotified) return false;
    this.#saveErrorNotified = false;
    return true;
  }

  saveJob(job: ImageJob): void {
    this.#jobs.set(job.id, job);
    this.#requestIds.set(job.requestId, job.id);
    this.#persist();
  }

  getJob(id: string): ImageJob | undefined {
    return this.#jobs.get(id);
  }

  findJobByRequestId(requestId: string): ImageJob | undefined {
    const id = this.#requestIds.get(requestId);
    return id === undefined ? undefined : this.#jobs.get(id);
  }

  listJobs(): readonly ImageJob[] {
    return [...this.#jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  listActiveJobs(): readonly ImageJob[] {
    return [...this.#jobs.values()].filter(
      (job) => job.status === "queued" || job.status === "submitting" || job.status === "running",
    );
  }

  /**
   * 写图片文件并返回落库后的 asset。
   * 目录不可写时仍返回 asset（previewUrl 用内存 data URL 兜底），只是不会持久化。
   */
  saveAsset(asset: ImageAsset, bytes?: Uint8Array): ImageAsset {
    if (this.#assets.has(asset.id)) throw new Error(`asset ${asset.id} 已存在`);

    let stored = asset;
    if (bytes !== undefined && this.#dir !== "") {
      try {
        const targetDir = path.join(this.#dir, LIBRARY_ASSET_SUBDIR);
        this.#mkdir(targetDir);
        const file = path.join(targetDir, assetFileName(asset.id, asset.mimeType, asset.createdAt));
        this.#writeFile(file, bytes);
        this.#files.set(asset.id, file);
        stored = { ...asset, previewUrl: assetUrl(asset.id) };
      } catch (error) {
        console.warn("[image-agent] 图片写盘失败，本次只在内存中保留：", (error as Error).message);
        this.#saveErrorNotified = true;
      }
    } else if (bytes !== undefined) {
      // 还没选目录：至少让界面能看到。
      stored = { ...asset, previewUrl: dataUrl(asset.mimeType, bytes) };
    }

    this.#assets.set(asset.id, stored);
    this.#persist();
    return stored;
  }

  /** 导入用：允许覆盖同 id 的任务。 */
  importJob(job: ImageJob): void {
    this.#jobs.set(job.id, job);
    this.#requestIds.set(job.requestId, job.id);
    this.#persist();
  }

  /** 导入用：允许覆盖同 id 的作品，字节会重新写进当前目录。 */
  importAsset(asset: ImageAsset, bytes: Uint8Array): ImageAsset {
    this.#assets.delete(asset.id);
    return this.saveAsset(asset, bytes);
  }

  /**
   * 扫描作品文件夹，把索引里没有的图片补回来。
   *
   * 索引（library.json）丢了/被清掉时，图片文件通常还在——这里按文件名里的
   * assetId 重建记录，尺寸从文件头读，提示词已经无从得知，明确写成"从文件恢复"。
   */
  rebuildIndex(): { readonly recovered: number; readonly skipped: number } {
    if (this.#dir === "") return { recovered: 0, skipped: 0 };
    const assetDir = path.join(this.#dir, LIBRARY_ASSET_SUBDIR);
    let names: readonly string[];
    try {
      names = readdirSync(assetDir);
    } catch {
      return { recovered: 0, skipped: 0 };
    }

    const knownFiles = new Set([...this.#files.values()].map((file) => path.basename(file)));
    let recovered = 0;
    let skipped = 0;

    for (const name of names) {
      if (knownFiles.has(name)) {
        skipped += 1;
        continue;
      }
      const match = /^(.+)_([^_]+)\.(png|jpe?g|webp)$/i.exec(name);
      if (!match) {
        skipped += 1;
        continue;
      }
      const assetId = match[2] ?? "";
      if (assetId === "" || this.#assets.has(assetId)) {
        skipped += 1;
        continue;
      }

      const file = path.join(assetDir, name);
      let bytes: Buffer;
      let mtimeMs: number;
      try {
        bytes = readFileSync(file);
        mtimeMs = statSync(file).mtimeMs;
      } catch {
        skipped += 1;
        continue;
      }

      const size = readImageSize(bytes);
      const mimeType = size?.mimeType ?? mimeTypeForName(name);
      const jobId = `recovered-${assetId}`;
      const prompt = "(从文件恢复，原提示词已丢失)";
      const createdAt = Math.round(mtimeMs);

      const asset: ImageAsset = {
        id: assetId,
        jobId,
        providerId: "recovered",
        model: "(未知)",
        mimeType,
        byteLength: bytes.length,
        width: size?.width ?? 0,
        height: size?.height ?? 0,
        prompt,
        previewUrl: assetUrl(assetId),
        createdAt,
      };
      const job: ImageJob = {
        id: jobId,
        requestId: jobId,
        providerId: "recovered",
        providerDisplayName: "本地文件",
        model: "(未知)",
        modelDisplayName: "从文件恢复",
        prompt,
        submittedPrompt: prompt,
        capabilities: RECOVERED_CAPABILITIES,
        referenceAssetIds: [],
        uploadsUserAssets: false,
        aspectRatio: "1:1",
        sizeMode: "ratio",
        format: "png",
        compression: 0,
        count: 1,
        attempts: 1,
        status: "succeeded",
        createdAt,
        updatedAt: createdAt,
        finishedAt: createdAt,
        assetIds: [assetId],
      };

      this.#assets.set(assetId, asset);
      this.#files.set(assetId, file);
      this.#jobs.set(jobId, job);
      this.#requestIds.set(jobId, jobId);
      recovered += 1;
    }

    if (recovered > 0) this.#persist();
    return { recovered, skipped };
  }

  allJobs(): readonly ImageJob[] {
    return [...this.#jobs.values()];
  }

  allAssets(): readonly ImageAsset[] {
    return [...this.#assets.values()];
  }

  /** 清空作品库：内存表 + 磁盘索引 + 已保存的图片文件。 */
  clearAll(): { readonly removedFiles: number } {
    let removedFiles = 0;
    for (const file of this.#files.values()) {
      try {
        unlinkSync(file);
        removedFiles += 1;
      } catch {
        // 文件已经不在了，忽略。
      }
    }
    this.#files.clear();
    this.#assets.clear();
    this.#jobs.clear();
    this.#requestIds.clear();
    this.#persist();
    return { removedFiles };
  }

  /** 删除单张作品：内存记录 + 磁盘文件；任务没有作品了就一起清掉。 */
  deleteAsset(assetId: string): { readonly ok: boolean; readonly removedFile: boolean } {
    const asset = this.#assets.get(assetId);
    if (asset === undefined) return { ok: false, removedFile: false };
    const file = this.#files.get(assetId);
    let removedFile = false;
    if (file !== undefined) {
      try {
        unlinkSync(file);
        removedFile = true;
      } catch {
        // 文件已经不在了，记录照删。
      }
    }
    this.#files.delete(assetId);
    this.#assets.delete(assetId);

    const remaining = [...this.#assets.values()].some((candidate) => candidate.jobId === asset.jobId);
    if (!remaining) {
      const job = this.#jobs.get(asset.jobId);
      this.#jobs.delete(asset.jobId);
      if (job !== undefined) this.#requestIds.delete(job.requestId);
    }
    this.#persist();
    return { ok: true, removedFile };
  }

  getAsset(id: string): ImageAsset | undefined {
    return this.#assets.get(id);
  }

  hasAsset(id: string): boolean {
    return this.#assets.has(id);
  }

  bytesForAsset(id: string): Uint8Array | undefined {
    const file = this.#files.get(id);
    if (file === undefined) return undefined;
    try {
      return readFileSync(file);
    } catch {
      return undefined;
    }
  }

  listAssetsForJob(jobId: string): readonly ImageAsset[] {
    return [...this.#assets.values()]
      .filter((asset) => asset.jobId === jobId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  fileSize(file: string): number {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  }

  #persist(): void {
    if (this.#indexDir === "") return;
    const index: IndexFile = {
      version: INDEX_VERSION,
      jobs: [...this.#jobs.values()],
      assets: [...this.#assets.values()].map((asset) => {
        const file = this.#files.get(asset.id);
        return file === undefined ? (asset as IndexedAsset) : { ...asset, file };
      }),
    };
    try {
      this.#mkdir(this.#indexDir);
      const temp = `${this.indexFile}.tmp`;
      this.#writeFile(temp, JSON.stringify(index));
      // 先写临时文件再改名：中途崩溃不会留下半截索引。
      if (this.#exists(temp)) {
        try {
          this.#rename(temp, this.indexFile);
        } catch {
          this.#copy(temp, this.indexFile);
        }
      }
    } catch (error) {
      console.warn("[image-agent] 作品索引写盘失败：", (error as Error).message);
      this.#saveErrorNotified = true;
    }
  }
}

/** 从文件恢复出来的任务没有真实能力信息，这里给一个最小声明。 */
const RECOVERED_CAPABILITIES = {
  textToImage: true,
  imageToImage: false,
  masks: false,
  referenceImageLimit: 0,
  aspectRatios: ["1:1"],
  outputCountLimit: 1,
  seed: false,
  negativePrompt: false,
  async: false,
  cancel: false,
  autoSize: false,
  customSize: false,
  sizes: [],
  transcode: false,
} as const;

function mimeTypeForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/** renderer 通过这个 scheme 读图片；协议处理器只接受已登记的 assetId。 */
export function assetUrl(assetId: string): string {
  return `ia-asset://asset/${encodeURIComponent(assetId)}`;
}

export function parseAssetUrl(url: string): string | undefined {
  const match = /^ia-asset:\/\/asset\/([^/?#]+)$/.exec(url);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function dataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function resolveLibrarySettings(raw: unknown, fallbackDir: string): LibrarySettings {
  if (typeof raw === "object" && raw !== null) {
    const dir = (raw as { dir?: unknown }).dir;
    if (isAbsoluteDirectory(dir)) return { dir: normalizeLibraryDir(dir) };
  }
  return { dir: fallbackDir };
}
