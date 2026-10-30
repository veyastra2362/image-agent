/**
 * Anthropic（Messages API）适配器。
 *
 * 只用于语言模型用途：改写提示词、规划 ImagePlan。Anthropic 不出图，所以不实现 submit/poll。
 * 与 OpenAI 兼容接口的差异：`x-api-key` 头、必须带 `anthropic-version`、system 是顶层字段、
 * 回复是 `content[]` 数组。
 */
import type { ImageCapabilities } from "@shared/image-generation";

import type { ImageProvider, ProviderDescriptor, ProviderModel } from "../provider";
import { ProviderRequestError } from "./openai-compatible";

export interface AnthropicProviderOptions {
  readonly id?: string;
  readonly displayName?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly string[];
  readonly defaultModel?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const NO_IMAGE_CAPS: ImageCapabilities = {
  textToImage: false,
  imageToImage: false,
  masks: false,
  referenceImageLimit: 0,
  aspectRatios: [],
  outputCountLimit: 0,
  seed: false,
  negativePrompt: false,
  async: false,
  cancel: false,
  autoSize: false,
  customSize: false,
  sizes: [],
  transcode: false,
};

const REWRITE_SYSTEM =
  "你是图像生成提示词助手。把用户的一句话改写成更适合文生图模型的详细提示词：" +
  "补充主体、构图、光线、色彩、材质与风格，保留原意，不要解释，只输出改写后的提示词本身，长度不超过 200 字。";

const PLAN_SYSTEM =
  "你是图像生成规划助手。把用户的一句话规划成一张图，只输出 JSON，格式：" +
  '{"prompt":"改写后的完整提示词","negativePrompt":"可选，不想出现的内容",' +
  '"aspectRatio":"可选，必须是 1:1/4:3/3:4/16:9/9:16/3:2/2:3/5:4/4:5/21:9/9:21/2:1/1:2 之一",' +
  '"count":可选整数1-10,"reasoning":"一句话说明为什么这样规划",' +
  '"questions":["可选，确实需要用户澄清时才给"]}。不要输出 JSON 以外的任何内容。';

export class AnthropicProvider implements ImageProvider {
  readonly descriptor: ProviderDescriptor;

  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: AnthropicProviderOptions) {
    if (options.models.length === 0) throw new Error("Anthropic 至少需要一个模型");
    const defaultModel = options.defaultModel ?? options.models[0];
    if (defaultModel === undefined) throw new Error("Anthropic 缺少默认模型");

    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.#timeoutMs = options.timeoutMs ?? 120_000;

    this.descriptor = {
      id: options.id ?? "anthropic",
      displayName: options.displayName ?? "Anthropic",
      description: "语言模型（Messages API）",
      defaultModel,
      models: options.models.map<ProviderModel>((id) => ({ id, displayName: id, capabilities: NO_IMAGE_CAPS })),
      uploadsUserAssets: false,
    };
  }

  getModel(model: string): ProviderModel | undefined {
    return this.descriptor.models.find((entry) => entry.id === model);
  }

  getCapabilities(model: string): ImageCapabilities | undefined {
    return this.getModel(model)?.capabilities;
  }

  async optimizePrompt(prompt: string, model: string, signal: AbortSignal): Promise<string> {
    return this.#message(model, REWRITE_SYSTEM, prompt, signal);
  }

  async planImage(prompt: string, model: string, signal: AbortSignal): Promise<string> {
    return this.#message(model, PLAN_SYSTEM, prompt, signal);
  }

  submit(): never {
    throw new Error("Anthropic 不支持出图；请把它配置成「语言模型」");
  }

  poll(): never {
    throw new Error("Anthropic 不支持轮询");
  }

  cancel(): Promise<boolean> {
    return Promise.resolve(false);
  }

  async #message(model: string, system: string, userText: string, signal: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason);
    if (signal.aborted) forward();
    signal.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("请求超时")), Math.min(this.#timeoutMs, 60_000));

    try {
      const response = await this.#fetch(`${this.#baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.#apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system,
          messages: [{ role: "user", content: userText }],
        }),
        signal: controller.signal,
        redirect: "error",
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const retryable = response.status === 429 || response.status >= 500;
        const code = response.status === 401 || response.status === 403 ? "provider-unavailable" : "provider-failed";
        const looksHtml = /^\s*</.test(text);
        throw new ProviderRequestError({
          code,
          message: `Anthropic 拒绝了这次请求（HTTP ${response.status}）：${
            looksHtml ? "网关返回了 HTML 错误页" : text.slice(0, 200)
          }`,
          retryable,
        });
      }

      const payload = (await response.json()) as { content?: unknown };
      const blocks = Array.isArray(payload.content) ? payload.content : [];
      const text = blocks
        .map((block) => (typeof block === "object" && block !== null ? (block as { text?: unknown }).text : undefined))
        .filter((value): value is string => typeof value === "string")
        .join("")
        .trim();
      if (text === "") throw new Error("Anthropic 没有返回文本内容");
      return text;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
    }
  }
}
