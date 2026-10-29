/**
 * Fake provider：只返回仓库里的固定测试图片，不访问网络、不产生费用。
 *
 * 它有两个模型，`fake-async-1` 走"提交 → 轮询 → 完成"的异步路径，
 * 用来在没有任何真实 Key 的情况下验证完整任务生命周期。
 */
import type { AspectRatio, ImageCapabilities } from "@shared/image-generation";
import { PRESET_RATIOS } from "@shared/image-generation";
import { readFixture } from "../fixtures";
import type {
  ImageProvider,
  ProviderDescriptor,
  ProviderGenerateRequest,
  ProviderModel,
  ProviderPollResult,
  ProviderSubmitResult,
} from "../provider";

export const FAKE_PROVIDER_ID = "fake";

/** 假服务只在本地出图，所以尺寸、格式相关能力全部声明为支持，用来覆盖 UI 的所有分支。 */
const SIZE_CAPABILITIES = {
  autoSize: true,
  customSize: true,
  sizes: [] as readonly string[],
  transcode: false,
} as const;

const CAPABILITIES: ImageCapabilities = {
  textToImage: true,
  imageToImage: true,
  masks: false,
  referenceImageLimit: 2,
  aspectRatios: PRESET_RATIOS,
  outputCountLimit: 4,
  seed: true,
  negativePrompt: true,
  async: true,
  cancel: true,
  ...SIZE_CAPABILITIES,
};

const LIMITED_CAPABILITIES: ImageCapabilities = {
  textToImage: true,
  imageToImage: false,
  masks: false,
  referenceImageLimit: 0,
  aspectRatios: ["1:1", "16:9", "9:16"],
  outputCountLimit: 1,
  seed: false,
  negativePrompt: false,
  async: false,
  cancel: false,
  ...SIZE_CAPABILITIES,
};

const MODELS: readonly ProviderModel[] = [
  { id: "fake-sync-1", displayName: "Fake Sync 1", capabilities: LIMITED_CAPABILITIES },
  { id: "fake-async-1", displayName: "Fake Async 1", capabilities: CAPABILITIES },
];

export const FAKE_DESCRIPTOR: ProviderDescriptor = {
  id: FAKE_PROVIDER_ID,
  displayName: "本地假服务",
  description: "离线测试用：只返回固定测试图片，不联网、不产生费用。",
  defaultModel: "fake-sync-1",
  models: MODELS,
  uploadsUserAssets: false,
};

export interface FakeProviderOptions {
  /** 异步模型在"运行中"停留的轮数；测试里设成 1。 */
  readonly pollRounds?: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 画面比例决定返回图的长宽，全部映射到已有 fixture。 */
function fixtureFor(aspectRatio: AspectRatio, index: number): string {
  if (aspectRatio === "16:9" || aspectRatio === "3:2") return "fake-landscape.png";
  if (aspectRatio === "9:16" || aspectRatio === "2:3") return "fake-portrait.png";
  return ["fake-square-a.png", "fake-square-b.png", "fake-square-c.png"][index % 3] ?? "fake-square-a.png";
}

interface PendingTask {
  readonly request: ProviderGenerateRequest;
  polls: number;
}

export class FakeProvider implements ImageProvider {
  readonly descriptor = FAKE_DESCRIPTOR;
  private readonly pollRounds: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly pending = new Map<string, PendingTask>();
  private nextTaskId = 1;

  constructor(options: FakeProviderOptions = {}) {
    this.pollRounds = options.pollRounds ?? 2;
    this.pollIntervalMs = options.pollIntervalMs ?? 0;
    this.sleep = options.sleep ?? defaultSleep;
  }

  getModel(model: string): ProviderModel | undefined {
    return MODELS.find((candidate) => candidate.id === model);
  }

  getCapabilities(model: string): ImageCapabilities | undefined {
    return this.getModel(model)?.capabilities;
  }

  async submit(request: ProviderGenerateRequest, signal: AbortSignal): Promise<ProviderSubmitResult> {
    const model = this.getModel(request.model);
    if (!model) throw new Error(`未知的假模型：${request.model}`);
    // 模拟一点点网络往返，让 renderer 能看到 submitting 状态。
    await this.sleep(30, signal);

    if (model.capabilities.async) {
      const remoteTaskId = `fake-task-${this.nextTaskId++}`;
      this.pending.set(remoteTaskId, { request, polls: 0 });
      return { state: "running", remoteTaskId, pollAfterMs: this.pollIntervalMs };
    }

    return { state: "completed", images: await this.render(request) };
  }

  async poll(remoteTaskId: string, signal: AbortSignal): Promise<ProviderPollResult> {
    const task = this.pending.get(remoteTaskId);
    if (!task) {
      return {
        state: "failed",
        error: { code: "provider-failed", message: "上游找不到该任务", retryable: false },
      };
    }
    await this.sleep(this.pollIntervalMs, signal);
    task.polls += 1;
    if (task.polls <= this.pollRounds) {
      return { state: "running", pollAfterMs: this.pollIntervalMs };
    }
    this.pending.delete(remoteTaskId);
    return { state: "completed", images: await this.render(task.request) };
  }

  async cancel(remoteTaskId: string): Promise<boolean> {
    return this.pending.delete(remoteTaskId);
  }

  private async render(request: ProviderGenerateRequest): Promise<readonly { bytes: Uint8Array; mimeType: string }[]> {
    const images = [];
    for (let index = 0; index < request.count; index += 1) {
      const bytes = await readFixture(fixtureFor(request.aspectRatio, index));
      images.push({ bytes, mimeType: "image/png" });
    }
    return images;
  }
}
