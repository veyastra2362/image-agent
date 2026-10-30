/**
 * fal.ai 适配器：队列式（提交 → 轮询状态 → 取结果）。
 *
 * 和 OpenAI 兼容接口的区别：
 *  - 模型是 app id（如 `fal-ai/flux/dev`），要拼在 URL 里；
 *  - 提交后返回 `request_id`，之后轮询 `/requests/{id}/status`；
 *  - 结果是图片 URL 列表，需要再下载成字节；
 *  - 参数放进 `input`，字段名各家不同，这里只映射最通用的一组。
 */
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
import { isProviderRequestError } from "../provider";
import { ProviderRequestError } from "./openai-compatible";

export interface FalProviderOptions {
  readonly id?: string;
  readonly displayName?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly string[];
  readonly defaultModel?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly pollAfterMs?: number;
}

const CAPABILITIES: ImageCapabilities = {
  textToImage: true,
  imageToImage: false,
  masks: false,
  referenceImageLimit: 0,
  aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
  outputCountLimit: 4,
  seed: true,
  negativePrompt: true,
  async: true,
  cancel: true,
  autoSize: true,
  customSize: true,
  sizes: [],
  transcode: true,
};

/** 复用 OpenAI 的字段名做尺寸映射；认不出的比例就不传。 */
const SIZE_BY_RATIO: Partial<Record<AspectRatio, string>> = {
  "1:1": "square_hd",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
};

export class FalProvider implements ImageProvider {
  readonly descriptor: ProviderDescriptor;

  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #pollAfterMs: number;

  constructor(options: FalProviderOptions) {
    if (options.models.length === 0) throw new Error("fal 至少需要一个 app id");
    const defaultModel = options.defaultModel ?? options.models[0];
    if (defaultModel === undefined) throw new Error("fal 缺少默认模型");

    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.#timeoutMs = options.timeoutMs ?? 300_000;
    this.#pollAfterMs = options.pollAfterMs ?? 1500;

    this.descriptor = {
      id: options.id ?? "fal",
      displayName: options.displayName ?? "fal.ai",
      description: "队列式出图（fal.app）",
      defaultModel,
      models: options.models.map<ProviderModel>((id) => ({ id, displayName: id, capabilities: CAPABILITIES })),
      uploadsUserAssets: false,
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

    const body = { input: this.#input(request) };
    try {
      const response = await this.#fetch(`${this.#baseUrl}/${request.model}`, {
        method: "POST",
        headers: { authorization: `Key ${this.#apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
        redirect: "error",
      });
      if (!response.ok) throw new ProviderRequestError(await this.#error(response));
      const payload = (await response.json()) as { request_id?: unknown; images?: unknown };
      if (Array.isArray(payload.images)) {
        // 少数同步 app 会直接给结果
        return { state: "completed", images: await this.#download(payload.images, signal) };
      }
      if (typeof payload.request_id !== "string" || payload.request_id === "") {
        throw new Error("上游没有返回 request_id");
      }
      return { state: "running", remoteTaskId: payload.request_id, pollAfterMs: this.#pollAfterMs };
    } catch (error) {
      throw this.#wrap(error, signal);
    }
  }

  async poll(remoteTaskId: string, signal: AbortSignal): Promise<ProviderPollResult> {
    const model = this.descriptor.defaultModel;
    try {
      const statusResponse = await this.#fetch(`${this.#baseUrl}/${model}/requests/${remoteTaskId}/status`, {
        headers: { authorization: `Key ${this.#apiKey}` },
        signal,
        redirect: "error",
      });
      if (!statusResponse.ok) throw new ProviderRequestError(await this.#error(statusResponse));
      const status = (await statusResponse.json()) as { status?: unknown };
      const value = typeof status.status === "string" ? status.status.toUpperCase() : "";
      if (value === "IN_QUEUE" || value === "IN_PROGRESS") return { state: "running", pollAfterMs: this.#pollAfterMs };
      if (value !== "COMPLETED") {
        return {
          state: "failed",
          error: { code: "provider-failed", message: `fal 任务状态：${value || "未知"}`, retryable: true },
        };
      }

      const resultResponse = await this.#fetch(`${this.#baseUrl}/${model}/requests/${remoteTaskId}`, {
        headers: { authorization: `Key ${this.#apiKey}` },
        signal,
        redirect: "error",
      });
      if (!resultResponse.ok) throw new ProviderRequestError(await this.#error(resultResponse));
      const result = (await resultResponse.json()) as { images?: unknown };
      const images = await this.#download(result.images, signal);
      if (images.length === 0) {
        return {
          state: "failed",
          error: { code: "provider-failed", message: "fal 没有返回图片", retryable: true },
        };
      }
      return { state: "completed", images };
    } catch (error) {
      if (signal.aborted) return { state: "cancelled" };
      if (isProviderRequestError(error)) return { state: "failed", error: error.detail };
      return {
        state: "failed",
        error: { code: "provider-failed", message: `查询失败：${(error as Error).message}`, retryable: true },
      };
    }
  }

  async cancel(remoteTaskId: string): Promise<boolean> {
    try {
      const response = await this.#fetch(`${this.#baseUrl}/${this.descriptor.defaultModel}/requests/${remoteTaskId}/cancel`, {
        method: "PUT",
        headers: { authorization: `Key ${this.#apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  #input(request: ProviderGenerateRequest): Record<string, unknown> {
    const input: Record<string, unknown> = { prompt: request.prompt, num_images: request.count };
    const size = SIZE_BY_RATIO[request.aspectRatio];
    if (size !== undefined) input.image_size = size;
    if (request.seed !== undefined) input.seed = request.seed;
    if (request.negativePrompt !== undefined && request.negativePrompt !== "") {
      input.negative_prompt = request.negativePrompt;
    }
    return input;
  }

  /** 结果给的是 URL，还得自己下载成字节。 */
  async #download(raw: unknown, signal: AbortSignal): Promise<ProviderImage[]> {
    if (!Array.isArray(raw)) return [];
    const out: ProviderImage[] = [];
    for (const entry of raw) {
      const url = typeof entry === "string" ? entry : (entry as { url?: unknown } | null)?.url;
      if (typeof url !== "string" || url === "") continue;
      const response = await this.#fetch(url, { signal, redirect: "error" });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const type = response.headers.get("content-type") ?? "image/png";
      out.push({ bytes, mimeType: type.split(";")[0] ?? "image/png" });
    }
    return out;
  }

  async #error(response: Response): Promise<ImageError> {
    const text = await response.text().catch(() => "");
    const retryable = response.status === 429 || response.status >= 500;
    const code = response.status === 401 || response.status === 403 ? "provider-unavailable" : "provider-failed";
    const detail = /^\s*</.test(text) ? "网关返回了 HTML 错误页" : text.slice(0, 200);
    return { code, message: `fal 请求失败（HTTP ${response.status}）：${detail}`, retryable };
  }

  #wrap(error: unknown, signal: AbortSignal): unknown {
    if (signal.aborted) return error;
    if (isProviderRequestError(error)) return error;
    return new ProviderRequestError({
      code: "provider-failed",
      message: `fal 提交失败：${(error as Error).message}`.slice(0, 200),
      retryable: true,
    });
  }
}
