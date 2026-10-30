/**
 * 作品库的落盘位置。
 *
 * 图片默认写到"图片"目录下的 Image Agent 文件夹（Windows 上即 C 盘用户目录），
 * 用户可以改成任意文件夹。索引文件留在 userData，切换目录不会让旧作品消失。
 */
export const LIBRARY_DIR_NAME = "Image Agent";
export const LIBRARY_ASSET_SUBDIR = "assets";

export interface LibrarySettings {
  /** 绝对路径；main 负责校验并创建。 */
  readonly dir: string;
}

export interface LibraryStats {
  readonly jobs: number;
  readonly assets: number;
  readonly bytes: number;
}

export interface LibrarySettingsView {
  readonly settings: LibrarySettings;
  /** 系统推荐目录（"图片"下的 Image Agent）。 */
  readonly defaultDir: string;
  /** 实际可用的目录；settings.dir 不可写时回退到 defaultDir。 */
  readonly resolvedDir: string;
  readonly stats: LibraryStats;
  /** 上次启动时是否有作品因为文件缺失被丢弃。 */
  readonly lastLoadWarning?: string;
}

export interface ChooseLibraryDirResult {
  readonly ok: boolean;
  readonly dir?: string;
  /** 失败原因；ok 为 true 时表示"切换成功但有告警"。 */
  readonly error?: string;
  /** 这次切换一起搬过去的作品数。 */
  readonly migrated?: number;
}

/** 只接受绝对路径；相对路径会让"作品存哪"取决于启动目录，必须拒绝。 */
export function isAbsoluteDirectory(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > 1024) return false;
  if (trimmed.includes("\0")) return false;
  // Windows 盘符、UNC 路径、以及 POSIX 根路径。
  return /^[A-Za-z]:[\\/]/.test(trimmed) || /^\\\\[^\\]+\\/.test(trimmed) || trimmed.startsWith("/");
}

export function normalizeLibraryDir(raw: string): string {
  const trimmed = raw.trim();
  // 去掉末尾分隔符，但保留盘符根本身（C:\ 不能被削成 C:）。
  return trimmed.length > 3 ? trimmed.replace(/[\\/]+$/, "") : trimmed;
}

/** 文件名里只用安全字符，避免提示词/模型名变成路径。 */
export function assetFileName(assetId: string, mimeType: string, createdAt: number): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  const safeId = assetId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return `${stamp}_${safeId}.${extension}`;
}
