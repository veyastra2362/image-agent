/**
 * 服务商配置存储：多个服务商并存，每个都有自己的地址、密钥与模型。
 *
 * 目录：`app.getPath("userData")/provider-settings.json`。文件权限尽力设为 0600。
 *
 * 三条刻意的设计：
 *  1. 密钥永远不回传 renderer；`view()` 只回答"存没存、加没加密"。
 *  2. 有系统钥匙串时只写密文（safeStorage）；拿不到才退回明文，并如实标记。
 *  3. 这是唯一的配置来源：应用不读 .env，也不读环境变量作为兜底。
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  DEFAULT_PROVIDER_SETTINGS,
  MAX_PROFILES,
  validateProviderFile,
  validateProviderProfile,
  type ProviderKeyStatus,
  type ProviderProfile,
  type ProviderPurpose,
  type ProviderSettingsView,
} from "@shared/provider-settings";

const FILE_NAME = "provider-settings.json";
const FILE_VERSION = 3;

interface StoredKey {
  readonly enc?: string;
  readonly plain?: string;
}

interface StoredFile {
  readonly version: number;
  readonly profiles: readonly ProviderProfile[];
  readonly activeId: string;
  readonly keys: Readonly<Record<string, StoredKey>>;
}

/** 由 main 注入的系统加密能力；测试里可以替换成任何实现。 */
export interface SecretCipher {
  readonly available: boolean;
  encrypt(plain: string): string;
  decrypt(payload: string): string;
}

export interface ProviderSettingsStoreOptions {
  readonly dir: string;
  /** 系统钥匙串加密；不可用时退回明文并明确告知界面。 */
  readonly cipher?: SecretCipher;
  readonly newId?: () => string;
  /** 测试可替换；默认真正的 fs。 */
  readonly readFile?: (file: string) => string;
  readonly writeFile?: (file: string, data: string) => void;
}

export class ProviderSettingsStore {
  readonly #dir: string;
  readonly #readFile: (file: string) => string;
  readonly #writeFile: (file: string, data: string) => void;
  readonly #cipher: SecretCipher | undefined;
  readonly #newId: () => string;

  #profiles: ProviderProfile[] = [defaultProfile()];
  #activeId = DEFAULT_PROFILE_ID;
  /** id → 密钥明文（只在内存里）。 */
  readonly #keys = new Map<string, string>();
  /** 哪几把密钥是加密落盘的。 */
  readonly #encrypted = new Set<string>();
  /** 有密文但解不开的配置（需要用户重新填）。 */
  readonly #unreadable = new Set<string>();

  constructor(options: ProviderSettingsStoreOptions) {
    this.#dir = options.dir;
    this.#readFile = options.readFile ?? ((file) => readFileSync(file, "utf8"));
    this.#writeFile = options.writeFile ?? defaultWrite;
    this.#cipher = options.cipher?.available === true ? options.cipher : undefined;
    this.#newId =
      options.newId ??
      (() => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.slice(0, 24));
  }

  get file(): string {
    return path.join(this.#dir, FILE_NAME);
  }

  get profiles(): readonly ProviderProfile[] {
    return this.#profiles;
  }

  get activeId(): string {
    return this.#activeId;
  }

  get active(): ProviderProfile {
    return this.#profiles.find((profile) => profile.id === this.#activeId) ?? this.#profiles[0] ?? defaultProfile();
  }

  /** 读盘。文件损坏或格式不对就退回默认配置——不能因为配置文件坏了打不开应用。 */
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

    const candidate = parsed as Partial<StoredFile> & {
      settings?: unknown;
      apiKey?: string;
      apiKeyEnc?: string;
    };

    // v2 及更早：单服务商 { settings, apiKey/apiKeyEnc }，迁移成一条 profile。
    if (candidate.profiles === undefined && candidate.settings !== undefined) {
      const legacy = validateProviderProfile({
        ...(candidate.settings as object),
        id: DEFAULT_PROFILE_ID,
        label: DEFAULT_PROFILE_LABEL,
      });
      if (legacy.ok) {
        this.#profiles = [legacy.value];
        this.#activeId = legacy.value.id;
        const key = this.#readLegacyKey(candidate);
        if (key !== undefined) {
          this.#keys.set(legacy.value.id, key);
          if (typeof candidate.apiKeyEnc === "string" && candidate.apiKeyEnc !== "") {
            this.#encrypted.add(legacy.value.id);
          }
        }
      } else {
        console.warn(`[image-agent] 旧版配置无效，已忽略：${legacy.error}`);
      }
      return;
    }

    const profiles = validateProviderFile(candidate);
    if (profiles === undefined) {
      console.warn("[image-agent] 服务商配置无效，已退回默认配置");
      return;
    }
    this.#profiles = [...profiles];
    const activeId = typeof candidate.activeId === "string" ? candidate.activeId : "";
    this.#activeId = this.#profiles.some((profile) => profile.id === activeId)
      ? activeId
      : (this.#profiles[0]?.id ?? DEFAULT_PROFILE_ID);

    const keys = candidate.keys;
    if (typeof keys === "object" && keys !== null) {
      for (const profile of this.#profiles) {
        const stored = (keys as Record<string, StoredKey>)[profile.id];
        if (typeof stored !== "object" || stored === null) continue;
        const plain = this.#decodeKey(stored);
        if (plain !== undefined) {
          this.#keys.set(profile.id, plain);
          // 密文读出来的，记下"已加密"，界面据此显示状态。
          if (typeof stored.enc === "string" && stored.enc !== "") this.#encrypted.add(profile.id);
        } else if (typeof stored.enc === "string" && stored.enc !== "") {
          // 有密文却解不开：告诉界面，让用户重新填，而不是静默变成"没配密钥"。
          this.#unreadable.add(profile.id);
        }
      }
    }
  }

  #readLegacyKey(candidate: { apiKey?: string; apiKeyEnc?: string }): string | undefined {
    if (typeof candidate.apiKeyEnc === "string" && candidate.apiKeyEnc !== "") {
      const decrypted = this.#decodeKey({ enc: candidate.apiKeyEnc });
      if (decrypted !== undefined) return decrypted;
    }
    if (typeof candidate.apiKey === "string" && candidate.apiKey.trim() !== "") {
      return candidate.apiKey.trim();
    }
    return undefined;
  }

  /** 解密失败（换机器/钥匙串失效）当作没存过，并留下日志而不是崩溃。 */
  #decodeKey(stored: StoredKey): string | undefined {
    if (typeof stored.enc === "string" && stored.enc !== "" && this.#cipher !== undefined) {
      try {
        const plain = this.#cipher.decrypt(stored.enc).trim();
        if (plain !== "") return plain;
      } catch (error) {
        console.warn("[image-agent] 已保存的 API Key 无法解密（可能换了系统账户），请重新填写：", (error as Error).message);
        return undefined;
      }
    }
    if (typeof stored.plain === "string" && stored.plain.trim() !== "") return stored.plain.trim();
    return undefined;
  }

  setActive(id: string): boolean {
    if (!this.#profiles.some((profile) => profile.id === id)) return false;
    this.#activeId = id;
    this.#persist();
    return true;
  }

  /** 新建一个空配置并切换过去。 */
  create(label?: string, purpose: ProviderPurpose = "image"): ProviderProfile {
    if (this.#profiles.length >= MAX_PROFILES) throw new Error(`最多 ${MAX_PROFILES} 个服务商`);
    const id = this.#uniqueId();
    const profile: ProviderProfile = {
      ...DEFAULT_PROVIDER_SETTINGS,
      id,
      purpose,
      // 两类各自编号：语言模型 1、2、3；服务商 1、2、3，互不占号。
      label:
        label?.trim() ||
        `${purpose === "text" ? "语言模型" : "服务商"} ${
          this.#profiles.filter((profile) => (profile.purpose ?? "image") === purpose).length + 1
        }`,
    };
    this.#profiles = [...this.#profiles, profile];
    this.#activeId = id;
    this.#persist();
    return profile;
  }

  upsert(profile: ProviderProfile): void {
    const index = this.#profiles.findIndex((entry) => entry.id === profile.id);
    if (index === -1) {
      if (this.#profiles.length >= MAX_PROFILES) throw new Error(`最多 ${MAX_PROFILES} 个服务商`);
      this.#profiles = [...this.#profiles, profile];
    } else {
      this.#profiles = this.#profiles.map((entry) => (entry.id === profile.id ? profile : entry));
    }
    this.#persist();
  }

  /** 删掉一个配置；最后一个不允许删。 */
  remove(id: string): { readonly ok: true } | { readonly ok: false; readonly error: string } {
    if (this.#profiles.length <= 1) return { ok: false, error: "至少要保留一个服务商配置" };
    if (!this.#profiles.some((profile) => profile.id === id)) return { ok: false, error: "配置不存在" };
    this.#profiles = this.#profiles.filter((profile) => profile.id !== id);
    this.#keys.delete(id);
    this.#encrypted.delete(id);
    if (this.#activeId === id) this.#activeId = this.#profiles[0]?.id ?? DEFAULT_PROFILE_ID;
    this.#persist();
    return { ok: true };
  }

  /**
   * 导出用的快照：密钥以明文给出。
   * safeStorage 的密文换机器就解不开，而备份要能迁移，所以这里必须是明文——
   * 它只会进用户自己选择的 ZIP，界面也已提示"含 API Key"。
   */
  exportPayload(): { profiles: readonly ProviderProfile[]; activeId: string; keys: Record<string, string> } {
    const keys: Record<string, string> = {};
    for (const [id, key] of this.#keys) keys[id] = key;
    return { profiles: this.#profiles, activeId: this.#activeId, keys };
  }

  /** 恢复出厂：只留一个空配置，所有密钥清空。 */
  reset(): void {
    this.#profiles = [defaultProfile()];
    this.#activeId = DEFAULT_PROFILE_ID;
    this.#keys.clear();
    this.#encrypted.clear();
    this.#persist();
  }

  /** 导入用：整体替换配置与密钥（密钥是不加密的明文，只在内存里短暂存在）。 */
  replaceAll(profiles: readonly ProviderProfile[], activeId: string, keys: ReadonlyMap<string, string>): void {
    this.#profiles = [...profiles];
    this.#activeId = this.#profiles.some((profile) => profile.id === activeId) ? activeId : (this.#profiles[0]?.id ?? DEFAULT_PROFILE_ID);
    this.#keys.clear();
    this.#encrypted.clear();
    for (const [id, key] of keys) if (this.#profiles.some((profile) => profile.id === id)) this.#keys.set(id, key);
    this.#persist();
  }

  keyFor(id: string): string | undefined {
    return this.#keys.get(id);
  }

  setApiKey(id: string, key: string): void {
    this.#unreadable.delete(id);
    const trimmed = key.trim();
    if (trimmed === "") this.#keys.delete(id);
    else this.#keys.set(id, trimmed);
    this.#persist();
  }

  clearApiKey(id: string): void {
    this.#keys.delete(id);
    this.#encrypted.delete(id);
    this.#unreadable.delete(id);
    this.#persist();
  }

  /** 给界面看的视图：多配置 + 每个配置的密钥状态，永远没有密钥本体。 */
  view(): ProviderSettingsView {
    const keys: Record<string, ProviderKeyStatus> = {};
    for (const profile of this.#profiles) {
      const stored = this.#keys.has(profile.id);
      keys[profile.id] = {
        hasApiKey: stored,
        apiKeyEncrypted: stored && this.#encrypted.has(profile.id),
        keyUnreadable: this.#unreadable.has(profile.id),
      };
    }
    return {
      profiles: this.#profiles,
      activeId: this.#activeId,
      keys,
      enabledCount: this.#profiles.filter(
        (profile) => profile.models.length > 0 && profile.baseUrl !== "" && this.#keys.has(profile.id),
      ).length,
    };
  }

  /** 密钥指纹：只用于判断"是不是同一把钥匙"，不可逆推密钥。 */
  keyFingerprint(id: string): string | undefined {
    const key = this.#keys.get(id);
    if (key === undefined) return undefined;
    return createHash("sha256").update(key).digest("hex").slice(0, 12);
  }

  #uniqueId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = this.#newId().toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (candidate !== "" && /^[a-z0-9][a-z0-9-]*$/.test(candidate) && !this.#profiles.some((p) => p.id === candidate)) {
        return candidate;
      }
    }
    return `p${Date.now().toString(36)}`;
  }

  #persist(): void {
    const keys: Record<string, StoredKey> = {};
    for (const [id, plain] of this.#keys) {
      if (this.#cipher !== undefined) {
        try {
          keys[id] = { enc: this.#cipher.encrypt(plain) };
          this.#encrypted.add(id);
          continue;
        } catch (error) {
          console.warn("[image-agent] 密钥加密失败，退回明文保存：", (error as Error).message);
        }
      }
      keys[id] = { plain };
      this.#encrypted.delete(id);
    }

    const data: StoredFile = {
      version: FILE_VERSION,
      profiles: this.#profiles,
      activeId: this.#activeId,
      keys,
    };
    try {
      this.#writeFile(this.file, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("[image-agent] 保存服务商配置失败", error);
    }
  }
}

function defaultProfile(): ProviderProfile {
  return { ...DEFAULT_PROVIDER_SETTINGS, id: DEFAULT_PROFILE_ID, label: DEFAULT_PROFILE_LABEL };
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
