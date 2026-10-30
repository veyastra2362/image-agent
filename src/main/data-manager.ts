/**
 * 数据导出 / 导入 / 清除。
 *
 * 设计要点：
 *  - 导出的是标准 ZIP，manifest.json 里写明包含哪些数据；导入时只恢复"勾选 ∩ 备份里有"的部分。
 *  - 图片按原文件名进 zip；导入时重新写进当前作品目录并重建预览地址，
 *    所以换机器、换保存目录导入都能用。
 *  - 清除不可撤销：调用方必须先让用户确认，这里只负责删干净并报告删了多少。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import AdmZip from "adm-zip";

import {
  DATA_ARCHIVE_VERSION,
  DATA_MANIFEST_NAME,
  type DataManifest,
  type DataResult,
  type DataSelection,
  type DataSummary,
} from "@shared/data-management";
import type { ImageAsset, ImageJob } from "@shared/image-generation";
import { validateProviderFile, type ProviderProfile } from "@shared/provider-settings";
import { decryptArchive, encryptArchive, isEncryptedArchive } from "./archive-cipher";
import type { FileJobStore } from "./library-store";
import type { ProviderSettingsStore } from "./provider-settings-store";

const SETTINGS_ENTRY = "settings/provider-settings.json";
const LIBRARY_INDEX_ENTRY = "library/library.json";
const ASSET_PREFIX = "library/assets/";

export interface DataManagerDeps {
  readonly userDataDir: string;
  readonly getStore: () => FileJobStore;
  readonly getSettings: () => ProviderSettingsStore;
  /** 配置变更后重建 provider 表。 */
  readonly applyProviders: () => void;
}

interface StoredSettingsFile {
  readonly profiles?: unknown;
  readonly activeId?: unknown;
  readonly keys?: unknown;
}

interface ParsedLibrary {
  readonly jobs: readonly ImageJob[];
  readonly assets: readonly { readonly asset: ImageAsset; readonly fileName: string }[];
}

export class DataManager {
  private readonly deps: DataManagerDeps;

  constructor(deps: DataManagerDeps) {
    this.deps = deps;
  }

  get settingsFile(): string {
    return path.join(this.deps.userDataDir, "provider-settings.json");
  }

  summary(): DataSummary {
    const store = this.deps.getStore();
    const stats = store.stats();
    return {
      profiles: this.deps.getSettings().profiles.length,
      jobs: stats.jobs,
      assets: stats.assets,
      libraryBytes: stats.bytes,
      libraryDir: store.dir,
      settingsFile: this.settingsFile,
    };
  }

  exportTo(target: string, selection: DataSelection, passphrase?: string): DataResult {
    if (!selection.settings && !selection.library) return { ok: false, error: "至少勾选一项要导出的数据" };
    const zip = new AdmZip();
    const entries: { label: string; bytes: number }[] = [];

    if (selection.settings) {
      // 用 store 的快照而不是直接打包配置文件：配置文件里的密钥是加密的，换机器解不开。
      const payload = JSON.stringify(this.deps.getSettings().exportPayload(), null, 2);
      zip.addFile(SETTINGS_ENTRY, Buffer.from(payload, "utf8"));
      entries.push({ label: "服务商配置（含 API Key 明文）", bytes: Buffer.byteLength(payload) });
    }

    if (selection.library) {
      const store = this.deps.getStore();
      const jobs = store.allJobs();
      const assets = store.allAssets();
      const index = {
        version: 1,
        jobs,
        assets: assets.map((asset) => {
          const file = store.fileForAsset(asset.id);
          return { ...asset, previewUrl: "", file: file === undefined ? undefined : `${ASSET_PREFIX}${path.basename(file)}` };
        }),
      };
      const indexJson = JSON.stringify(index);
      zip.addFile(LIBRARY_INDEX_ENTRY, Buffer.from(indexJson, "utf8"));
      entries.push({ label: `任务与索引（${jobs.length} 条任务 / ${assets.length} 张图）`, bytes: Buffer.byteLength(indexJson) });

      let imageBytes = 0;
      let imageCount = 0;
      for (const asset of assets) {
        const file = store.fileForAsset(asset.id);
        if (file === undefined || !existsSync(file)) continue;
        const bytes = readFileSync(file);
        zip.addFile(`${ASSET_PREFIX}${path.basename(file)}`, bytes);
        imageBytes += bytes.length;
        imageCount += 1;
      }
      if (imageCount > 0) entries.push({ label: `图片文件（${imageCount} 个）`, bytes: imageBytes });
    }

    const manifest: DataManifest = {
      app: "image-agent",
      version: DATA_ARCHIVE_VERSION,
      exportedAt: Date.now(),
      includes: selection,
    };
    zip.addFile(DATA_MANIFEST_NAME, Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

    try {
      mkdirSync(path.dirname(target), { recursive: true });
      const secret = passphrase?.trim() ?? "";
      if (secret === "") {
        zip.writeZip(target);
        return { ok: true, path: target, message: `已导出到 ${target}`, entries };
      }
      // 带口令：整个 ZIP 加一层 AES-GCM，备份文件里不再有明文 Key。
      writeFileSync(target, encryptArchive(zip.toBuffer(), secret));
      return {
        ok: true,
        path: target,
        message: `已导出到 ${target}（已用口令加密，导入时需要同一口令）`,
        entries,
      };
    } catch (error) {
      return { ok: false, error: `写入备份失败：${(error as Error).message}` };
    }
  }

  importFrom(source: string, selection: DataSelection, passphrase?: string): DataResult {
    if (!selection.settings && !selection.library) return { ok: false, error: "至少勾选一项要导入的数据" };
    if (!existsSync(source)) return { ok: false, error: "文件不存在" };

    let zip: AdmZip;
    try {
      const raw = readFileSync(source);
      if (isEncryptedArchive(raw)) {
        const secret = passphrase?.trim() ?? "";
        if (secret === "") {
          return { ok: false, error: "这个备份已加密，请输入导出时设置的口令", needsPassphrase: true };
        }
        zip = new AdmZip(decryptArchive(raw, secret));
      } else {
        zip = new AdmZip(raw);
      }
    } catch (error) {
      return { ok: false, error: `无法读取备份：${(error as Error).message}` };
    }

    const manifestEntry = zip.getEntry(DATA_MANIFEST_NAME);
    if (manifestEntry === null) return { ok: false, error: "压缩包里没有 manifest.json，不是本应用导出的备份" };
    let manifest: DataManifest;
    try {
      manifest = JSON.parse(manifestEntry.getData().toString("utf8")) as DataManifest;
    } catch {
      return { ok: false, error: "manifest.json 无法解析" };
    }
    if (manifest.app !== "image-agent") return { ok: false, error: "这个压缩包不是本应用导出的" };
    if (manifest.version > DATA_ARCHIVE_VERSION) {
      return { ok: false, error: `备份版本（${manifest.version}）比当前应用新，请先升级应用` };
    }

    const restored: string[] = [];

    if (selection.settings && manifest.includes.settings) {
      const entry = zip.getEntry(SETTINGS_ENTRY);
      if (entry === null) return { ok: false, error: "备份里缺少配置数据" };
      const parsed = this.#parseSettings(entry.getData().toString("utf8"));
      if ("error" in parsed) return { ok: false, error: parsed.error };
      this.deps.getSettings().replaceAll(parsed.profiles, parsed.activeId, parsed.keys);
      this.deps.applyProviders();
      restored.push(`服务商配置 ${parsed.profiles.length} 个`);
    }

    if (selection.library && manifest.includes.library) {
      const entry = zip.getEntry(LIBRARY_INDEX_ENTRY);
      if (entry === null) return { ok: false, error: "备份里缺少任务索引" };
      const parsed = parseLibraryIndex(entry.getData().toString("utf8"));
      if ("error" in parsed) return { ok: false, error: parsed.error };

      const store = this.deps.getStore();
      let images = 0;
      for (const item of parsed.assets) {
        const fileName = path.basename(item.fileName);
        if (fileName === "") continue;
        const fileEntry = zip.getEntry(`${ASSET_PREFIX}${fileName}`);
        if (fileEntry === null) continue;
        store.importAsset(item.asset, fileEntry.getData());
        images += 1;
      }
      for (const job of parsed.jobs) store.importJob(job);
      restored.push(`任务 ${parsed.jobs.length} 条 / 图片 ${images} 张`);
    }

    if (restored.length === 0) return { ok: false, error: "勾选的数据在备份里不存在，未做任何修改" };
    return { ok: true, path: source, message: `已导入：${restored.join("、")}` };
  }

  clear(selection: DataSelection): DataResult {
    if (!selection.settings && !selection.library) return { ok: false, error: "至少勾选一项要清除的数据" };
    const done: string[] = [];

    if (selection.settings) {
      this.deps.getSettings().reset();
      this.deps.applyProviders();
      done.push("服务商配置");
    }
    if (selection.library) {
      const removed = this.deps.getStore().clearAll();
      done.push(`任务与图片（删除 ${removed.removedFiles} 个文件）`);
    }
    return { ok: true, message: `已清除：${done.join("、")}` };
  }

  /** 备份里的密钥是明文（只存在于用户自己的压缩包里），导入后由 store 重新加密落盘。 */
  #parseSettings(
    raw: string,
  ): { profiles: readonly ProviderProfile[]; activeId: string; keys: Map<string, string> } | { error: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: "备份里的配置不是合法 JSON" };
    }
    const file = parsed as StoredSettingsFile;
    const profiles = validateProviderFile(file);
    if (profiles === undefined) return { error: "备份里的服务商配置无效" };

    const keys = new Map<string, string>();
    if (typeof file.keys === "object" && file.keys !== null) {
      for (const [id, stored] of Object.entries(file.keys as Record<string, unknown>)) {
        // 兼容两种形状：本应用导出的明文字符串，以及配置文件里 { plain } / { enc } 的对象。
        const key = typeof stored === "string" ? stored : (stored as { plain?: unknown } | null)?.plain;
        if (typeof key === "string" && key.trim() !== "") keys.set(id, key.trim());
      }
    }
    return {
      profiles,
      activeId: typeof file.activeId === "string" ? file.activeId : (profiles[0]?.id ?? "default"),
      keys,
    };
  }
}

function parseLibraryIndex(raw: string): ParsedLibrary | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "备份里的任务索引不是合法 JSON" };
  }
  const record = parsed as { jobs?: unknown; assets?: unknown };
  if (!Array.isArray(record.jobs) || !Array.isArray(record.assets)) return { error: "备份里的索引结构不对" };

  const assets: { asset: ImageAsset; fileName: string }[] = [];
  for (const entry of record.assets) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.jobId !== "string") continue;
    // 预览地址由存储重建，清空以免把旧机器的路径带进来。
    assets.push({ asset: { ...(item as unknown as ImageAsset), previewUrl: "" }, fileName: typeof item.file === "string" ? item.file : "" });
  }

  const jobs = record.jobs.filter(
    (job): job is ImageJob => typeof job === "object" && job !== null && typeof (job as { id?: unknown }).id === "string",
  );
  return { jobs, assets };
}

export function defaultExportName(now = new Date(), encrypted = false): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `image-agent-backup-${stamp}.${encrypted ? "iaz" : "zip"}`;
}
