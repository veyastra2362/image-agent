/**
 * 本地配置：只由 main 读取，永远不会经过 IPC 到 renderer。
 *
 * 密钥来源优先级（后面的覆盖前面的，空值视为未设置）：
 *   1. 进程环境变量
 *   2. 仓库根目录的 .env（已被 .gitignore 忽略，权限 0600 由用户自己保证）
 *
 * .env 只支持最朴素的 `KEY=VALUE` 行：`#` 开头是注释，值两侧引号会被去掉。
 * 不展开变量、不执行命令——配置文件来自磁盘，按不可信文本处理。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const KEY_NAME = "IMAGE_AGENT_API_KEY";
const BASE_URL_NAME = "IMAGE_AGENT_BASE_URL";
const MODEL_NAME = "IMAGE_AGENT_MODEL";

export interface ProviderConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** 可选的默认模型；未设置时用 provider 声明里的默认值。 */
  readonly defaultModel?: string;
}

export interface LoadConfigOptions {
  /** 仓库根目录；默认取 .env 所在目录（main 运行时由调用方传入）。 */
  readonly rootDir: string;
  readonly env?: NodeJS.ProcessEnv;
  /** 读取 .env 的函数，测试里可以替换。 */
  readonly readFile?: (file: string) => string;
}

/** 解析 .env 文本为键值对；重复的键以后出现的为准。 */
export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) values[key] = value;
  }
  return values;
}

/** 只允许 http(s) 且必须能解析成 URL；其余一律视为配置错误。 */
export function normalizeBaseUrl(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return trimmed;
}

/**
 * 读取 provider 配置。缺 key 或缺 base URL 时返回 `{configured:false, reason}`，
 * 而不是抛错——没有密钥时应用照常启动，只是界面里不会出现这个 provider。
 *
 * 优先级：非空环境变量 > .env > 空。把某个环境变量显式设为空串（`IMAGE_AGENT_API_KEY=`）
 * 表示"明确关闭"，会忽略 .env 里的同名项。
 */
export function loadProviderConfig(
  options: LoadConfigOptions,
): { readonly configured: true; readonly config: ProviderConfig } | { readonly configured: false; readonly reason: string } {
  const env = options.env ?? process.env;
  const readFile = options.readFile ?? ((file: string) => readFileSync(file, "utf8"));

  let fromFile: Record<string, string> = {};
  let fileError: string | undefined;
  try {
    fromFile = parseDotEnv(readFile(path.join(options.rootDir, ".env")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") fileError = `读取 .env 失败：${String((error as Error).message).slice(0, 120)}`;
  }

  // 显式设为空串等于"明确关闭"：不读 .env 里的值。这样 `IMAGE_AGENT_API_KEY= npm run dev`
  // 或冒烟脚本就能强制只用离线 provider，而不用改配置文件。
  const isDisabled = (name: string): boolean => env[name] !== undefined && env[name]?.trim() === "";
  const pick = (name: string): string => {
    if (isDisabled(name)) return "";
    const fromEnv = env[name];
    if (fromEnv !== undefined) return fromEnv;
    return fromFile[name] ?? "";
  };

  const apiKey = pick(KEY_NAME).trim();
  if (apiKey === "") {
    return { configured: false, reason: fileError ?? `未配置 ${KEY_NAME}（在 .env 或环境变量里设置后重启应用）` };
  }

  const baseUrl = normalizeBaseUrl(pick(BASE_URL_NAME));
  if (baseUrl === undefined) {
    return { configured: false, reason: `${BASE_URL_NAME} 未设置或不是合法的 http(s) 地址` };
  }

  const defaultModel = pick(MODEL_NAME).trim();
  return {
    configured: true,
    config: { apiKey, baseUrl, ...(defaultModel === "" ? {} : { defaultModel }) },
  };
}
