/**
 * Responses API（`POST {base}/responses`）适配器：流式取图。
 *
 * 和 Images API 的区别：
 *  - 请求用 `input` + `stream: true`，中间步骤图像走 `partial_images`；
 *  - 响应是 SSE，图片可能出现在 `response.completed` 的 output 里，
 *    也可能以 `…image_generation_call.partial_image` 的形式逐块到达。
 *
 * 上游字段名各网关不一致，所以这里**不假设固定事件名**：
 * 任何事件里的 base64 图片都会被收集，partial 只作为进度，最终图以实现事件为准。
 */
import type { AspectRatio, ImageCapabilities, ImageError } from "@shared/image-generation";

import type {
  ImageProvider,
  ProviderDescriptor,
  ProviderGenerateRequest,
  ProviderImage,
  ProviderModel,
  ProviderSubmitResult,
} from "../provider";
import { isProviderRequestError } from "../provider";
import { ProviderRequestError } from "./openai-compatible";
import { isDoneSentinel, SseParser } from "../sse";

export interface ResponsesProviderOptions {
  readonly id?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly { readonly id: string; readonly displayName: string }[];
  readonly defaultModel?: string;
  readonly partialImages?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly agentModel?: string;
}

const SUPPORTED_RATIOS: readonly AspectRatio[] = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
  "9:21",
  "2:1",
  "1:2",
];

const CAPABILITIES: ImageCapabilities = {
  textToImage: true,
  imageToImage: false,
  masks: false,
  referenceImageLimit: 0,
  aspectRatios: SUPPORTED_RATIOS,
  outputCountLimit: 1,
  seed: false,
  negativePrompt: false,
  // 流式是一次请求读完整个流，没有远端任务可轮询/取消。
  async: false,
  cancel: false,
  autoSize: true,
  customSize: true,
  sizes: [],
  transcode: true,
};

export class ResponsesProvider implements ImageProvider {
  readonly descriptor: ProviderDescriptor;

  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #partialImages: number;

  constructor(options: ResponsesProviderOptions) {
    if (options.models.length === 0) throw new Error("Responses provider 至少需要一个模型");
    const defaultModel = options.defaultModel ?? options.models[0]?.id;
    if (defaultModel === undefined) throw new Error("Responses provider 缺少默认模型");

    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.#timeoutMs = options.timeoutMs ?? 300_000;
    this.#partialImages = Math.min(3, Math.max(0, Math.round(options.partialImages ?? 2)));

    this.descriptor = {
      id: options.id ?? "openai-responses",
      displayName: options.displayName ?? "OpenAI Responses",
      description: options.description ?? "流式出图（Responses API）",
      defaultModel,
      models: options.models.map<ProviderModel>((spec) => ({
        id: spec.id,
        displayName: spec.displayName,
        capabilities: CAPABILITIES,
      })),
      uploadsUserAssets: false,
      ...(options.agentModel === undefined ? {} : { agentModel: options.agentModel }),
    };
  }

  getModel(model: string): ProviderModel | undefined {
    return this.descriptor.models.find((entry) => entry.id === model);
  }

  getCapabilities(model: string): ImageCapabilities | undefined {
    return this.getModel(model)?.capabilities;
  }

  async submit(request: ProviderGenerateRequest, signal: AbortSignal): Promise<ProviderSubmitResult> {
    if (!this.getModel(request.model)) throw new Error(`未知模型：${request.model}`);

    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason);
    if (signal.aborted) forward();
    signal.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("请求超时")), this.#timeoutMs);

    try {
      const response = await this.#fetch(`${this.#baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(this.#body(request)),
        signal: controller.signal,
        redirect: "error",
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new ProviderRequestError(toProviderError(response.status, text));
      }
      if (response.body === null) throw new Error("上游没有返回流式响应体");

      const images = await this.#readStream(response.body, request);
      if (images.length === 0) throw new Error("上游没有返回图片数据");
      return { state: "completed", images };
    } catch (error) {
      if (signal.aborted) throw error;
      if (isProviderRequestError(error)) throw error;
      throw new ProviderRequestError({
        code: "provider-failed",
        message: `流式请求失败：${(error as Error).message}`.slice(0, 200),
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
    }
  }

  #body(request: ProviderGenerateRequest): Record<string, unknown> {
    const tool: Record<string, unknown> = { type: "image_generation" };
    if (this.#partialImages > 0) tool.partial_images = this.#partialImages;
    if (request.size !== undefined) tool.size = `${request.size.width}x${request.size.height}`;

    return {
      model: request.model,
      input: [{ role: "user", content: [{ type: "input_text", text: request.prompt }] }],
      modalities: ["image"],
      tools: [tool],
      stream: true,
    };
  }

  /** 读完整个 SSE：中间图只报进度，最终图收集起来。 */
  async #readStream(body: ReadableStream<Uint8Array>, request: ProviderGenerateRequest): Promise<ProviderImage[]> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    const finals: ProviderImage[] = [];
    let partialIndex = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        if (isDoneSentinel(event)) continue;
        const payload = parseJson(event.data);
        if (event.event === undefined && payload === undefined) continue;

        if (event.event === "error" || event.event === "response.failed") {
          throw new ProviderRequestError({
            code: "provider-failed",
            message: `上游流式错误：${describeFailure(payload, event.data)}`,
            retryable: true,
          });
        }

        const partial = firstBase64Image(payload);
        if (partial === undefined) continue;

        const isPartial = event.event?.includes("partial") === true;
        if (isPartial) {
          partialIndex += 1;
          request.onPartialImage?.({ index: partialIndex, bytes: Buffer.from(partial, "base64") });
          continue;
        }
        finals.push({ bytes: Buffer.from(partial, "base64"), mimeType: "image/png" });
      }
    }

    // 同一个事件里可能既带 partial 又带 final；去重后返回。
    return dedupe(finals);
  }

  poll(): Promise<never> {
    return Promise.reject(new Error("Responses 适配器不支持轮询"));
  }

  cancel(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

function parseJson(data: string): unknown {
  if (data.trim() === "") return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/** 在任意形状的 JSON 里找第一段 base64 图片（各家字段名不同）。 */
function firstBase64Image(payload: unknown): string | undefined {
  if (typeof payload === "string") return looksLikeImage(payload) ? payload : undefined;
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const found = firstBase64Image(entry);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof payload !== "object" || payload === null) return undefined;
  for (const value of Object.values(payload as Record<string, unknown>)) {
    const found = firstBase64Image(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

function looksLikeImage(text: string): boolean {
  // PNG base64 都以 iVBORw0KGgo 开头；用长度下限排除误判（1×1 的测试图也有 ~90 字符）。
  return text.length >= 40 && text.startsWith("iVBORw0KGgo");
}

function dedupe(images: readonly ProviderImage[]): ProviderImage[] {
  const seen = new Set<string>();
  const out: ProviderImage[] = [];
  for (const image of images) {
    const key = `${image.bytes.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(image);
  }
  return out;
}

function describeFailure(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "object" && error !== null) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message !== "") return message.slice(0, 200);
    }
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message.slice(0, 200);
  }
  return fallback.slice(0, 200);
}

function toProviderError(status: number, text: string): ImageError {
  let message = text.slice(0, 200);
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      const error = (parsed as { error?: unknown }).error;
      const detail = typeof error === "object" && error !== null ? (error as { message?: unknown }).message : undefined;
      if (typeof detail === "string" && detail !== "") message = detail.slice(0, 300);
    }
  } catch {
    // 保留原始文本
  }
  const retryable = status === 429 || status >= 500;
  const code = status === 401 || status === 403 ? "provider-unavailable" : "provider-failed";
  return { code, message: `服务商拒绝了这次请求（HTTP ${status}）：${message}`, retryable };
}
