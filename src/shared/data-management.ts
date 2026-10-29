/**
 * 数据管理：导出 / 导入 / 清除。
 *
 * 三类数据用同一组复选框：应用配置（服务商连接设置与密钥）、任务与图片（作品库）。
 * 导出是标准 ZIP，里面有 manifest.json 说明包含了什么，导入时按 manifest + 复选框取交集，
 * 不会出现"我明明没勾配置却被覆盖了"这种事。
 */

export interface DataSelection {
  /** 服务商配置 + API Key。 */
  readonly settings: boolean;
  /** 任务记录与图片文件。 */
  readonly library: boolean;
}

export type DataOperation = "export" | "import" | "clear";

export interface DataSummary {
  /** 已保存的服务商配置数。 */
  readonly profiles: number;
  /** 任务数 / 作品数 / 图片占用字节。 */
  readonly jobs: number;
  readonly assets: number;
  readonly libraryBytes: number;
  /** 图片目录。 */
  readonly libraryDir: string;
  /** 配置文件的绝对路径（方便用户自己备份）。 */
  readonly settingsFile: string;
}

export interface DataArchiveEntry {
  readonly label: string;
  readonly bytes: number;
}

export type DataResult =
  | {
      readonly ok: true;
      readonly message: string;
      /** 导出/导入的文件路径。 */
      readonly path?: string;
      readonly entries?: readonly DataArchiveEntry[];
    }
  | { readonly ok: false; readonly error: string };

export const DATA_ARCHIVE_VERSION = 1;
export const DATA_MANIFEST_NAME = "manifest.json";

export interface DataManifest {
  readonly app: "image-agent";
  readonly version: number;
  readonly exportedAt: number;
  readonly includes: DataSelection;
}

export function isDataSelection(value: unknown): value is DataSelection {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.settings === "boolean" && typeof record.library === "boolean";
}
