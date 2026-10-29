/**
 * OpenAI 兼容的图片生成 adapter（`POST {baseUrl}/images/generations`）。
 *
 * 只依赖公开的 OpenAI 图片接口形状：
 *   { model, prompt, n, size } → { data: [{ b64_json | url, size?, revised_prompt? }] }
 *
 * 2026-10 对真实网关（img-api.dialoguedui.com）实测：HTTP 200，`data[0].b64_json` 是
 * 1024x1024 的 PNG，另有 `id`、`revised_prompt`、`size` 和全零的 `usage`；返回尺寸与请求一致。
 * 不带 `response_format`，默认就是 base64。
 *
 * 能力声明比协议更保守：协议里没有 seed、negative prompt、取消的通用定义，
 * 所以这里一律声明不支持，而不是"先发出去试试"。界面据此隐藏这些控件。
 *
 * 密钥只存在于这个对象的私有字段里，不写日志、不进错误信息、不返回给调用方。
 */
import { PRESET_RATIOS } from "@shared/image-generation";
import type { AspectRatio, ImageCapabilities, ImageError } from "@shared/image-generation";
import type {
  ImageProvider,
  ProviderDescriptor,
  ProviderGenerateRequest,
  ProviderImage,
  ProviderModel,
  ProviderPollResult,
  ProviderSubmitResult,
} from "../provider";

export interface OpenAICompatibleModelSpec {
  readonly id: string;
  readonly displayName: string;
  /** 每张图费用；上游未提供时省略，界面显示"上游未提供"。 */
}

export interface OpenAICompatibleOptions {
  readonly id?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly OpenAICompatibleModelSpec[];
  readonly defaultModel?: string;
  /** 注入 fetch 以便离线测试；默认用全局 fetch。 */
  readonly fetchImpl?: typeof fetch;
  /** 单次网络请求的超时；提交本身可能跑几十秒，默认 180s。 */
  readonly timeoutMs?: number;
  /** 下载返回 URL 图片的超时，默认 60s。 */
  readonly downloadTimeoutMs?: number;
}

/**
 * gpt-image 系列接受的固定尺寸集合。
 *
 * 只有 1024x1024 是实测过的（2026-10，img-api.dialoguedui.com 返回同尺寸 PNG）；
 * 另外两种横竖版沿用 OpenAI 官方 gpt-image-1 的尺寸表，未在本网关上验证。
 */
export const SUPPORTED_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * 上游尺寸表只有三种，所以"比例 + 基准分辨率"在这里是就近吸附：
 * 比例先归到最接近的 1:1 / 3:2 / 2:3，分辨率决定短边是 1024 还是 1536。
 * 吸附规则在 pickSize 里，界面会显示吸附后的真实尺寸，不会让人以为能出 4:3。
 */
export const SIZE_BY_ASPECT: Readonly<Partial<Record<AspectRatio, string>>> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

/** 比例吸附表：常用的 4:3 / 16:9 归到 3:2，3:4 / 9:16 归到 2:3，5:4 等也各自就近。 */
const RATIO_SNAP: Readonly<Partial<Record<Exclude<AspectRatio, "custom">, AspectRatio>>> = {
  "1:1": "1:1",
  "4:3": "3:2",
  "3:2": "3:2",
  "16:9": "3:2",
  "5:4": "3:2",
  "2:1": "3:2",
  "21:9": "3:2",
  "3:4": "2:3",
  "2:3": "2:3",
  "9:16": "2:3",
  "4:5": "2:3",
  "1:2": "2:3",
  "9:21": "2:3",
};

/**
 * 比例 + 基准分辨率 → 上游尺寸字符串。
 *
 * 1K（≤1280）用短边 1024，2K 用短边 1536；4K 及以上没有对应尺寸，返回 undefined，
 * 界面据此提前告诉用户"当前模型不支持该分辨率"。
 */
export function pickSize(aspectRatio: AspectRatio, resolution: number): string | undefined {
  if (aspectRatio === "custom") return undefined;
  const snapped = RATIO_SNAP[aspectRatio];
  if (snapped === undefined) return undefined;
  const short = Math.round(resolution);
  if (short > 2048) return undefined;
  const shortEdge = short <= 1280 ? 1024 : 1536;
  if (snapped === "1:1") return `${shortEdge}x${shortEdge}`;
  if (snapped === "3:2") return `1536x${shortEdge}`;
  return `${shortEdge}x1536`;
}
const SUPPORTED_RATIOS: readonly AspectRatio[] = ["1:1", "4:3", "3:4"];

const CAPABILITIES: ImageCapabilities = {
  textToImage: true,
  imageToImage: false,
  masks: false,
  referenceImageLimit: 0,
  aspectRatios: SUPPORTED_RATIOS,
  outputCountLimit: 4,
  seed: false,
  negativePrompt: false,
  // 一次性请求/响应：任务在 main 里等结果，没有可轮询的远端任务，也就无法取消。
  async: false,
  cancel: false,
  // 实测（2026-10-29，gpt-image-2）：不传 size 时上游自己返回 1254×1254，故支持自动尺寸。
  autoSize: true,
  // 实测：1792×1024、1024×1792、2048×2048 都原样返回，说明不限尺寸。
  customSize: true,
  // 没有固定尺寸表：比例/像素都原样发出去。
  sizes: [],
  // jpeg/webp 由 main 用 sharp 在本地转码，不依赖上游。
  transcode: true,
};

export class OpenAICompatibleProvider implements ImageProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly downloadTimeoutMs: number;

  constructor(options: OpenAICompatibleOptions) {
    if (options.models.length === 0) throw new Error("OpenAI 兼容 provider 至少需要一个模型");
    const defaultModel = options.defaultModel ?? options.models[0]?.id;
    if (!defaultModel) throw new Error("OpenAI 兼容 provider 缺少默认模型");

    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? 60_000;
    this.descriptor = {
      id: options.id ?? "openai-images",
      displayName: options.displayName ?? "OpenAI 兼容图片服务",
      description:
        options.description ?? "调用你自己配置的 OpenAI 兼容接口；提示词会发送到该服务商。",
      defaultModel,
      models: options.models.map<ProviderModel>((spec) => ({
        id: spec.id,
        displayName: spec.displayName,
        capabilities: CAPABILITIES,
      })),
      uploadsUserAssets: false,
    };
  }

  getModel(model: string): ProviderModel | undefined {
    return this.descriptor.models.find((candidate) => candidate.id === model);
  }

  getCapabilities(model: string): ImageCapabilities | undefined {
    return this.getModel(model)?.capabilities;
  }

  async submit(request: ProviderGenerateRequest, signal: AbortSignal): Promise<ProviderSubmitResult> {
    if (!this.getModel(request.model)) {
      throw new Error(`未知模型：${request.model}`);
    }

    const size = request.size === undefined ? undefined : `${request.size.width}x${request.size.height}`;
    const body = {
      model: request.model,
      prompt: request.prompt,
      n: request.count,
      // auto：完全不传 size，由上游决定。其余情况传固定尺寸字符串。
      ...(size === undefined ? {} : { size }),
    };

    const response = await this.request(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
      timeoutMs: this.timeoutMs,
    });

    if (!response.ok) throw new ProviderRequestError(toProviderError(response.status, response.json, response.text));

    const images = await this.collectImages(response.json, request, signal);
    return { state: "completed", images };
  }

  poll(): Promise<ProviderPollResult> {
    // 声明了 async:false，service 不会调用它。
    return Promise.reject(new Error("该 provider 不支持轮询"));
  }

  cancel(): Promise<boolean> {
    // 没有远端任务 ID，无法请求上游停止。
    return Promise.resolve(false);
  }

  // -------------------------------------------------------------------------

  private async request(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; timeoutMs: number },
  ): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(init.signal.reason);
    if (init.signal.aborted) forwardAbort();
    init.signal.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("请求超时")), init.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: controller.signal,
        redirect: "error",
      });
      const text = await response.text();
      const json = parseJsonMaybe(text);
      return { ok: response.ok, status: response.status, json, text };
    } catch (error) {
      if (init.signal.aborted) throw error;
      throw new Error(`网络请求失败：${String((error as Error).message).slice(0, 200)}`);
    } finally {
      clearTimeout(timer);
      init.signal.removeEventListener("abort", forwardAbort);
    }
  }

  /**
   * 接受两种返回：
   *   { data: [{ b64_json | url }] }        —— 标准 JSON
   *   { data: [{ b64_json | url }], ... }   —— 包在 SSE `data: {...}` 行里（部分网关会这样回）
   * 每张图都必须是 PNG，尺寸是否等于请求值由 main 的尺寸校验负责。
   */
  private async collectImages(payload: unknown, request: ProviderGenerateRequest, signal: AbortSignal): Promise<readonly ProviderImage[]> {
    const data = isRecord(payload) ? payload.data : undefined;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("上游没有返回图片数据");
    }

    const images: ProviderImage[] = [];
    for (const [index, entry] of data.entries()) {
      if (!isRecord(entry)) throw new Error(`第 ${index + 1} 张图片格式不正确`);
      const bytes = await this.imageBytes(entry, index, signal);
      images.push({ bytes, mimeType: "image/png" });
    }

    // 上游会回显实际出图尺寸；与请求不一致时至少留下可诊断的痕迹（任务详情里能看到）。
    // auto 模式没有请求尺寸，跳过这项检查——此时上游给什么就是什么。
    const expected =
      request.size === undefined ? undefined : `${request.size.width}x${request.size.height}`;
    if (expected !== undefined) {
      const mismatched = data
        .map((entry) => (isRecord(entry) && typeof entry.size === "string" ? entry.size : undefined))
        .filter((size) => size !== undefined && size !== expected);
      if (mismatched.length > 0) {
        throw new Error(`上游返回的尺寸 ${mismatched.join("、")} 与请求的 ${expected} 不一致`);
      }
    }
    return images;
  }

  private async imageBytes(entry: Record<string, unknown>, index: number, signal: AbortSignal): Promise<Uint8Array> {
    const b64 = entry.b64_json;
    if (typeof b64 === "string" && b64.length > 0) {
      const bytes = Buffer.from(b64, "base64");
      assertPng(bytes, index);
      return bytes;
    }

    const url = entry.url;
    if (typeof url === "string" && url.length > 0) {
      const parsed = parseHttpsUrl(url);
      if (!parsed) throw new Error(`第 ${index + 1} 张图片的下载地址不是 https`);
      const bytes = await this.download(parsed, index, signal);
      assertPng(bytes, index);
      return bytes;
    }

    throw new Error(`第 ${index + 1} 张图片缺少 b64_json 或 url`);
  }

  /** 图片二进制单独走一次请求，按 ArrayBuffer 读，避免把图片当文本解码。 */
  private async download(url: string, index: number, signal: AbortSignal): Promise<Buffer> {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal.reason);
    if (signal.aborted) forwardAbort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("下载超时")), this.downloadTimeoutMs);

    try {
      const response = await this.fetchImpl(url, { method: "GET", signal: controller.signal, redirect: "error" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > MAX_IMAGE_BYTES) throw new Error("图片超出大小限制");
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES) throw new Error("图片超出大小限制");
      return buffer;
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(`下载第 ${index + 1} 张图片失败：${String((error as Error).message).slice(0, 200)}`);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", forwardAbort);
    }
  }
}

function assertPng(bytes: Buffer, index: number): void {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || bytes.length > MAX_IMAGE_BYTES || !signature.every((byte, i) => bytes[i] === byte)) {
    throw new Error(`第 ${index + 1} 张返回内容不是合法 PNG`);
  }
}

function parseHttpsUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export class ProviderRequestError extends Error {
  readonly detail: ImageError;
  constructor(detail: ImageError) {
    super(detail.message);
    this.name = "ProviderRequestError";
    this.detail = detail;
  }
}

/** 上游错误映射到 ImageError 的 code；消息里绝不回显 Authorization。 */
export function toProviderError(status: number, body: unknown, text: string): ImageError {
  const detail = errorDetail(body) ?? text.slice(0, 200);
  const suffix = detail === "" ? "" : `：${detail}`;
  if (status === 401 || status === 403) {
    return { code: "provider-unavailable", message: `服务商拒绝了密钥（HTTP ${status}）${suffix}`, retryable: false };
  }
  if (status === 404) {
    return { code: "unknown-model", message: `服务商没有这个模型或接口${suffix}`, retryable: false };
  }
  if (status === 400 || status === 422) {
    return { code: "invalid-request", message: `服务商拒绝了这次请求（HTTP ${status}）${suffix}`, retryable: false };
  }
  if (status === 429) {
    return { code: "provider-unavailable", message: `触发服务商限流（HTTP 429）${suffix}`, retryable: true };
  }
  if (status >= 500) {
    return { code: "provider-unavailable", message: `服务商暂时不可用（HTTP ${status}）${suffix}`, retryable: true };
  }
  return { code: "provider-failed", message: `服务商返回 HTTP ${status}${suffix}`, retryable: false };
}

function errorDetail(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const error = body.error;
  if (typeof error === "string") return error.slice(0, 200);
  if (isRecord(error) && typeof error.message === "string") return error.message.slice(0, 200);
  if (typeof body.message === "string") return body.message.slice(0, 200);
  return undefined;
}

/**
 * 解析响应体：优先当普通 JSON；失败时尝试 SSE 形式（若干 `data: {...}` 行），
 * 取最后一个带 data 数组的事件。真实网关可能二选一，这里都容忍。
 */
export function parseJsonMaybe(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // 继续尝试 SSE。
  }

  let last: unknown;
  for (const line of trimmed.split(/\r?\n/)) {
    const payload = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (payload === "" || payload === "[DONE]") continue;
    try {
      const parsed: unknown = JSON.parse(payload);
      last = isRecord(parsed) && Array.isArray(parsed.data) ? parsed : (last ?? parsed);
    } catch {
      // 不是 JSON 的行直接忽略。
    }
  }
  return last;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
