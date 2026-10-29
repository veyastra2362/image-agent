/**
 * 服务商连接配置：界面可编辑、保存在本机、密钥只留在 main。
 *
 * 这个文件只能有类型、常量和纯函数，不得导入 Node/Electron/DOM。
 */

export const PROVIDER_KINDS = ["openai-compatible", "fal"] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  "openai-compatible": "OpenAI 兼容接口",
  fal: "fal.ai",
};

export const API_FLAVORS = ["images", "responses"] as const;

/**
 * 请求走哪种接口：
 *   images    —— POST {baseUrl}/images/generations，一次返回全部图片
 *   responses —— POST {baseUrl}/responses，可流式，支持 partial_images
 */
export type ApiFlavor = (typeof API_FLAVORS)[number];

export const API_FLAVOR_LABELS: Record<ApiFlavor, string> = {
  images: "Images API（/images/generations）",
  responses: "Responses API（/responses）",
};

/** 是否支持"中间步骤图像"（partial_images）。只有 Responses API 有这个参数。 */
export function supportsPartialImages(flavor: ApiFlavor): boolean {
  return flavor === "responses";
}

export const PARTIAL_IMAGE_RANGE = { min: 0, max: 3 } as const;

export const API_TIMEOUT_RANGE = { min: 10, max: 600, default: 180 } as const;

export interface ProviderSettings {
  readonly kind: ProviderKind;
  readonly baseUrl: string;
  readonly flavor: ApiFlavor;
  /** 用户勾选要启用的模型 ID，顺序即界面上显示的顺序。 */
  readonly models: readonly string[];
  /** 默认模型；必须包含在 models 里。 */
  readonly defaultModel?: string;
  /** 开流式传输：Responses API 会走 SSE，并按中间步骤图像保持连接。 */
  readonly stream: boolean;
  /** partial_images：0–3。仅 stream + responses 时生效。 */
  readonly partialImages: number;
  /** 单次请求超时（秒）。 */
  readonly timeoutSeconds: number;
}

/** 上游探测到的单个模型。 */
export interface UpstreamModel {
  readonly id: string;
  readonly displayName?: string;
}

export type ProviderTestResult =
  | { readonly ok: true; readonly models: readonly UpstreamModel[]; readonly message: string }
  | { readonly ok: false; readonly error: string };

export type ModelFetchResult =
  | { readonly ok: true; readonly models: readonly UpstreamModel[] }
  | { readonly ok: false; readonly error: string };

/** 一个可选的服务商配置：id 由 main 生成，label 给用户看。 */
export interface ProviderProfile extends ProviderSettings {
  readonly id: string;
  readonly label: string;
}

/** 单个 profile 在界面上的密钥状态；永远没有密钥本体。 */
export interface ProviderKeyStatus {
  readonly hasApiKey: boolean;
  /** 密钥是否由系统钥匙串加密后落盘（Electron safeStorage）。 */
  readonly apiKeyEncrypted: boolean;
}

/** 界面能看到的配置状态：多个服务商 + 密钥状态（不含密钥）。 */
export interface ProviderSettingsView {
  readonly profiles: readonly ProviderProfile[];
  readonly activeId: string;
  readonly keys: Readonly<Record<string, ProviderKeyStatus>>;
  /** 当前同时生效的服务商数量（有密钥且有模型的）。 */
  readonly enabledCount: number;
}

export const MAX_PROFILES = 8;
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_LABEL_LENGTH = 40;

export const DEFAULT_PROFILE_ID = "default";
export const DEFAULT_PROFILE_LABEL = "默认服务商";

/** 校验界面提交的单个 profile：id + label + 字段。 */
export function validateProviderProfile(
  raw: unknown,
): { readonly ok: true; readonly value: ProviderProfile } | { readonly ok: false; readonly error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "服务商配置格式不正确" };
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !PROFILE_ID_PATTERN.test(record.id)) {
    return { ok: false, error: "服务商内部 ID 不合法" };
  }
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (label === "" || label.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: `名称不能为空，且不超过 ${MAX_LABEL_LENGTH} 个字符` };
  }
  const validated = validateProviderSettings(record);
  if (!validated.ok) return validated;
  return { ok: true, value: { ...validated.value, id: record.id, label } };
}

/** 校验整份文件（多个 profile + activeId）。 */
export function validateProviderFile(raw: unknown): readonly ProviderProfile[] | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const list = (raw as { profiles?: unknown }).profiles;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_PROFILES) return undefined;
  const profiles: ProviderProfile[] = [];
  for (const entry of list) {
    const validated = validateProviderProfile(entry);
    if (!validated.ok) return undefined;
    if (profiles.some((profile) => profile.id === validated.value.id)) return undefined;
    profiles.push(validated.value);
  }
  return profiles;
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  kind: "openai-compatible",
  baseUrl: "",
  flavor: "images",
  models: [],
  stream: false,
  partialImages: 2,
  timeoutSeconds: API_TIMEOUT_RANGE.default,
};

export const MAX_MODELS = 32;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const MAX_BASE_URL_LENGTH = 512;

/** fal.ai 生成走队列：提交后轮询 status 端点。声明出来供界面说明。 */
export const FAL_QUEUE_NOTE = "fal.ai 使用队列接口：提交后轮询 status/result，任务本身是异步的。";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeBaseUrlInput(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "" || trimmed.length > MAX_BASE_URL_LENGTH) return undefined;
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
 * 校验来自 renderer 的设置。main 必须调用它——renderer 不是安全边界。
 * 只返回可读的错误文案，不回显任何输入里的密钥（这个对象里本来就没有密钥）。
 */
export function validateProviderSettings(raw: unknown): { readonly ok: true; readonly value: ProviderSettings } | { readonly ok: false; readonly error: string } {
  if (!isRecord(raw)) return { ok: false, error: "设置格式不正确" };

  const kind = raw.kind;
  if (typeof kind !== "string" || !(PROVIDER_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "不支持的服务商类型" };
  }

  const flavor = raw.flavor;
  if (typeof flavor !== "string" || !(API_FLAVORS as readonly string[]).includes(flavor)) {
    return { ok: false, error: "不支持的 API 接口类型" };
  }

  const baseUrl = typeof raw.baseUrl === "string" ? normalizeBaseUrlInput(raw.baseUrl) : undefined;
  if (baseUrl === undefined) {
    return { ok: false, error: "API 地址必须是合法的 http(s) URL，且不能带账号密码" };
  }

  if (!Array.isArray(raw.models)) return { ok: false, error: "模型列表必须是数组" };
  const models: string[] = [];
  for (const entry of raw.models) {
    if (typeof entry !== "string" || !MODEL_ID_PATTERN.test(entry)) {
      return { ok: false, error: `模型 ID 不合法：${String(entry).slice(0, 64)}` };
    }
    if (models.includes(entry)) return { ok: false, error: `模型 ID 重复：${entry}` };
    models.push(entry);
  }
  if (models.length > MAX_MODELS) return { ok: false, error: `最多启用 ${MAX_MODELS} 个模型` };

  let defaultModel: string | undefined;
  if (raw.defaultModel !== undefined) {
    if (typeof raw.defaultModel !== "string" || !models.includes(raw.defaultModel)) {
      return { ok: false, error: "默认模型必须来自已启用的模型列表" };
    }
    defaultModel = raw.defaultModel;
  }

  const stream = raw.stream === true;

  const partialImages = raw.partialImages ?? 0;
  if (
    typeof partialImages !== "number" ||
    !Number.isInteger(partialImages) ||
    partialImages < PARTIAL_IMAGE_RANGE.min ||
    partialImages > PARTIAL_IMAGE_RANGE.max
  ) {
    return { ok: false, error: `中间步骤图像数必须是 ${PARTIAL_IMAGE_RANGE.min}–${PARTIAL_IMAGE_RANGE.max} 的整数` };
  }

  const timeoutSeconds = raw.timeoutSeconds ?? API_TIMEOUT_RANGE.default;
  if (
    typeof timeoutSeconds !== "number" ||
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < API_TIMEOUT_RANGE.min ||
    timeoutSeconds > API_TIMEOUT_RANGE.max
  ) {
    return { ok: false, error: `超时必须是 ${API_TIMEOUT_RANGE.min}–${API_TIMEOUT_RANGE.max} 秒的整数` };
  }

  return {
    ok: true,
    value: {
      kind: kind as ProviderKind,
      baseUrl,
      flavor: flavor as ApiFlavor,
      models,
      ...(defaultModel === undefined ? {} : { defaultModel }),
      stream,
      partialImages,
      timeoutSeconds,
    },
  };
}

/** 由设置推导出实际生效的 partial_images：不流式或不是 Responses 接口时恒为 0。 */
export function effectivePartialImages(settings: ProviderSettings): number {
  return settings.stream && supportsPartialImages(settings.flavor) ? settings.partialImages : 0;
}
