/**
 * 服务商配置存储：把界面里填的设置、以及 API Key 落到本机。
 *
 * 目录：`app.getPath("userData")/provider-settings.json`（Windows 上是
 * `%APPDATA%/image-agent`）。文件权限尽力设为 0600。
 *
 * 两点刻意的设计：
 *  1. 密钥单独存放，读写都不经过 renderer；`view()` 只回答"有没有存过"。
 *  2. `.env` / 环境变量里已经有密钥时，文件里的密钥不生效，界面也只能去改文件——
 *     避免"界面上改了一遍却没作用"这种最难查的配置问题。
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_PROVIDER_SETTINGS,
  validateProviderSettings,
  type ProviderSettings,
  type ProviderSettingsView,
} from "@shared/provider-settings";

const FILE_NAME = "provider-settings.json";
const FILE_VERSION = 1;

interface StoredFile {
  readonly version: number;
  readonly settings: ProviderSettings;
  readonly apiKey?: string;
}

export interface ProviderSettingsStoreOptions {
  readonly dir: string;
  /** 测试可替换；默认真正的 fs。 */
  readonly readFile?: (file: string) => string;
  readonly writeFile?: (file: string, data: string) => void;
}

export class ProviderSettingsStore {
  readonly #dir: string;
  readonly #readFile: (file: string) => string;
  readonly #writeFile: (file: string, data: string) => void;
  #settings: ProviderSettings = DEFAULT_PROVIDER_SETTINGS;
  #apiKey: string | undefined;

  constructor(options: ProviderSettingsStoreOptions) {
    this.#dir = options.dir;
    this.#readFile = options.readFile ?? ((file) => readFileSync(file, "utf8"));
    this.#writeFile = options.writeFile ?? defaultWrite;
  }

  get file(): string {
    return path.join(this.#dir, FILE_NAME);
  }

  /** 读盘。文件损坏或格式不对就退回默认值——不能因为配置文件坏了打不开应用。 */
  load(): void {
    let raw: string;
    try {
      raw = this.#readFile(this.file);
    } catch {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("[image-agent] provider-settings.json 不是合法 JSON，已忽略");
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;

    const candidate = parsed as Partial<StoredFile>;
    const validated = validateProviderSettings(candidate.settings);
    if (validated.ok) this.#settings = validated.value;
    else console.warn(`[image-agent] 配置无效，已忽略：${validated.error}`);

    if (typeof candidate.apiKey === "string" && candidate.apiKey.trim() !== "") {
      this.#apiKey = candidate.apiKey.trim();
    }
  }

  /** 只写设置；密钥保持不变。 */
  saveSettings(next: ProviderSettings): void {
    this.#settings = next;
    this.#persist();
  }

  setApiKey(key: string): void {
    const trimmed = key.trim();
    this.#apiKey = trimmed === "" ? undefined : trimmed;
    this.#persist();
  }

  clearApiKey(): void {
    this.#apiKey = undefined;
    this.#persist();
  }

  get settings(): ProviderSettings {
    return this.#settings;
  }

  get apiKey(): string | undefined {
    return this.#apiKey;
  }

  /**
   * 给界面看的视图。`apiKeyFromEnv` 为真时，界面上存的密钥不生效，
   * 需要用户去 .env / 环境变量里改。
   */
  view(envKeyPresent: boolean): ProviderSettingsView {
    return {
      settings: this.#settings,
      hasApiKey: envKeyPresent || this.#apiKey !== undefined,
      apiKeyFromEnv: envKeyPresent,
    };
  }

  /** 密钥指纹：只用于"改的是不是同一把钥匙"，不可逆推密钥。 */
  keyFingerprint(): string | undefined {
    if (this.#apiKey === undefined) return undefined;
    return createHash("sha256").update(this.#apiKey).digest("hex").slice(0, 12);
  }

  #persist(): void {
    const data: StoredFile = {
      version: FILE_VERSION,
      settings: this.#settings,
      ...(this.#apiKey === undefined ? {} : { apiKey: this.#apiKey }),
    };
    try {
      this.#writeFile(this.file, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("[image-agent] 保存服务商配置失败", error);
    }
  }
}

function defaultWrite(file: string, data: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  // 先写临时文件再改名：中途崩溃不会留下半截 JSON。
  const temp = `${file}.tmp`;
  writeFileSync(temp, data, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(temp, 0o600);
  } catch {
    // Windows 上没有 POSIX 权限位，忽略即可。
  }
  renameSync(temp, file);
}
