/**
 * 任务编排：校验 → 预算 → 排队 → 提交 → 轮询 → 保存结果。
 *
 * 这里不包含任何厂商协议细节；所有网络/格式工作都在 provider adapter 里完成。
 * 所有输入都来自 IPC 或网络，一律先校验再做任何副作用。
 */
import { randomUUID } from "node:crypto";
import {
  applyTransition,
  checkBudget,
  checkCapabilities,
  validateCreateJobInput,
  validateJobId,
  resolveRatioSize,
  type AspectRatio,
  type BudgetStatus,
  type ImageAsset,
  type ImageBootstrap,
  type ImageJob,
  type ImageRequestResult,
  type ImageTaskEvent,
  type Notification,
  type ProviderRef,
  type RuntimeBudget,
} from "@shared/image-generation";
import { readPngSize } from "./fixtures";
import { transcodeImage } from "./transcode";
import { isProviderRequestError } from "./provider";
import type { ImageProvider, ProviderImage, ProviderModel } from "./provider";
import type { JobStore } from "./store";
import { toTaskEvent } from "./store";

export interface ServiceDependencies {
  readonly providers: readonly ImageProvider[];
  readonly store: JobStore;
  readonly emit: (event: ImageTaskEvent) => void;
  readonly notify: (notification: Notification) => void;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly sessionBudget?: RuntimeBudget;
  readonly retryDelayMs?: number;
}

export type ServiceResult = ImageRequestResult;

interface ActiveRun {
  readonly controller: AbortController;
}

/** 老请求不带分辨率时的缺省档位（1K）。 */
const DEFAULT_RESOLUTION = 1024;

const MAX_DOWNLOAD_ATTEMPTS = 3;
const MAX_POLL_TRANSIENT_FAILURES = 3;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export class ImageGenerationService {
  private readonly providers: Map<string, ImageProvider>;
  private readonly store: JobStore;
  private readonly emit: (event: ImageTaskEvent) => void;
  private readonly notify: (notification: Notification) => void;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly sessionBudget: RuntimeBudget;
  private readonly retryDelayMs: number;
  private readonly runs = new Map<string, ActiveRun>();
  private budget: BudgetStatus | undefined;

  constructor(deps: ServiceDependencies) {
    this.providers = new Map(deps.providers.map((provider) => [provider.descriptor.id, provider]));
    this.store = deps.store;
    this.emit = deps.emit;
    this.notify = deps.notify;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => `job-${randomUUID()}`);
    this.sessionBudget = deps.sessionBudget ?? {};
    this.retryDelayMs = deps.retryDelayMs ?? 0;
  }

  getBootstrap(): ImageBootstrap {
    this.recomputeBudget();
    return {
      providers: this.providerRefs(),
      jobs: this.store.listJobs().map((job) => toTaskEvent(job, this.store)),
      budget: this.budgetStatus(),
    };
  }

  async createJob(raw: unknown): Promise<ServiceResult> {
    const parsed = validateCreateJobInput(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const input = parsed.value;

    const replay = this.store.findJobByRequestId(input.requestId);
    if (replay) {
      if (replay.providerId === input.providerId && replay.prompt === input.prompt) {
        // 同一 requestId 重复提交（例如 renderer 超时重试）：返回同一任务，不重复提交。
        return { ok: true, event: toTaskEvent(replay, this.store) };
      }
      return {
        ok: false,
        error: { code: "invalid-request", message: "requestId 已用于另一个任务", retryable: false },
      };
    }

    const provider = this.providers.get(input.providerId);
    if (!provider) {
      return { ok: false, error: { code: "unknown-provider", message: "未知的服务商", retryable: false } };
    }

    const modelId = input.model ?? provider.descriptor.defaultModel;
    const model = provider.getModel(modelId);
    if (!model) {
      return {
        ok: false,
        error: { code: "unknown-model", message: "该服务商没有这个模型", retryable: false },
      };
    }

    // 参考图只接受本应用认识的 asset ID；renderer 传来的路径、URL 或伪造 ID 在这里被拒绝。
    for (const assetId of input.referenceAssetIds) {
      if (!this.store.hasAsset(assetId)) {
        return {
          ok: false,
          error: { code: "reference-not-found", message: "参考图不存在或未保存到本地作品库", retryable: false },
        };
      }
    }

    const aspectRatio: AspectRatio = input.aspectRatio ?? model.capabilities.aspectRatios[0] ?? "1:1";
    const sizeMode = input.sizeMode ?? "ratio";
    const format = input.format ?? "png";
    const compression = input.compression ?? 0;

    // 尺寸在这里定死：provider 只接收最终宽高，不再自己猜比例含义。
    const requestedSize =
      sizeMode === "custom"
        ? input.width !== undefined && input.height !== undefined
          ? { width: input.width, height: input.height }
          : undefined
        : sizeMode === "ratio"
          ? resolveRatioSize(aspectRatio, DEFAULT_RESOLUTION)
          : undefined;

    if (format !== "png" && !model.capabilities.transcode) {
      return {
        ok: false,
        error: {
          code: "unsupported-capability",
          message: "当前模型不支持导出 JPEG / WebP",
          retryable: false,
        },
      };
    }

    const capabilityError = checkCapabilities({
      capabilities: model.capabilities,
      referenceCount: input.referenceAssetIds.length,
      aspectRatio,
      count: input.count,
      sizeMode,
      ...(requestedSize === undefined ? {} : { requestedSize }),
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      ...(input.negativePrompt === undefined ? {} : { negativePrompt: input.negativePrompt }),
    });
    if (capabilityError) {
      return { ok: false, error: { code: "unsupported-capability", message: capabilityError, retryable: false } };
    }

    const billableImages = provider.descriptor.billable ? input.count : 0;
    const costPerImage = billableImages > 0 ? (model.costPerImage ?? 0) : 0;
    const budgetCheck = checkBudget({
      budget: this.sessionBudget,
      costPerImage,
      count: input.count,
      ...(input.budgetLimit === undefined ? {} : { requestLimit: input.budgetLimit }),
    });
    if (!budgetCheck.ok) {
      const message = budgetCheck.reason === "request-limit" ? "超过本次预算上限" : "超过会话预算上限";
      this.notify({
        level: "warning",
        message: `${message}（需要 ${budgetCheck.cost}，未提交任何请求）。`,
      });
      return { ok: false, error: { code: "budget-exceeded", message, retryable: false } };
    }

    const submittedPrompt = input.agentPrompt ?? input.prompt;
    const createdAt = this.now();
    const job: ImageJob = {
      id: this.newId(),
      requestId: input.requestId,
      providerId: provider.descriptor.id,
      providerDisplayName: provider.descriptor.displayName,
      model: model.id,
      modelDisplayName: model.displayName,
      status: "queued",
      prompt: input.prompt,
      ...(input.agentPrompt === undefined ? {} : { agentPrompt: input.agentPrompt }),
      submittedPrompt,
      capabilities: model.capabilities,
      referenceAssetIds: input.referenceAssetIds,
      uploadsUserAssets: provider.descriptor.uploadsUserAssets && input.referenceAssetIds.length > 0,
      aspectRatio,
      sizeMode,
      ...(requestedSize === undefined ? {} : { requestedSize }),
      format,
      compression,
      count: input.count,
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      ...(input.negativePrompt === undefined ? {} : { negativePrompt: input.negativePrompt }),
      billableImages,
      ...(input.budgetLimit === undefined ? {} : { budgetLimit: input.budgetLimit }),
      ...(costPerImage > 0 && model.currency
        ? { estimatedCost: { amount: costPerImage * input.count, currency: model.currency } }
        : {}),
      ...(input.agentPrompt === undefined
        ? {}
        : { agentRun: { planner: "manual", useRewrittenPrompt: true, instruction: input.prompt } }),
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
      assetIds: [],
    };

    this.store.saveJob(job);
    this.emit(toTaskEvent(job, this.store));
    void this.run(job.id);
    return { ok: true, event: toTaskEvent(job, this.store) };
  }

  async cancelJob(raw: unknown): Promise<ServiceResult> {
    const parsed = validateJobId(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const job = this.store.getJob(parsed.value);
    if (!job) {
      return { ok: false, error: { code: "job-not-found", message: "任务不存在", retryable: false } };
    }
    if (isTerminal(job.status)) return { ok: true, event: toTaskEvent(job, this.store) };

    const run = this.runs.get(job.id);
    const provider = this.providers.get(job.providerId);
    let upstreamStopped = true;
    if (job.status === "running" && job.remoteTaskId && provider && job.capabilities.cancel) {
      upstreamStopped = await provider.cancel(job.remoteTaskId).catch(() => false);
    }
    run?.controller.abort("cancelled");

    const updated = applyTransition(job, { status: "cancelled", sticky: true, at: this.now() });
    this.store.saveJob(updated);
    this.emit(toTaskEvent(updated, this.store));

    if (!upstreamStopped) {
      // 上游没确认停止：界面显示真实状态，不能假装已停止。
      this.notify({ level: "warning", message: "已结束本地等待，但上游未确认停止；该请求可能仍在计费。" });
    }
    return { ok: true, event: toTaskEvent(updated, this.store) };
  }

  /** 关闭时中止所有进行中的任务，避免请求悬空。 */
  dispose(): void {
    for (const run of this.runs.values()) run.controller.abort("shutdown");
    this.runs.clear();
  }

  // -------------------------------------------------------------------------

  private providerRefs(): ProviderRef[] {
    return [...this.providers.values()].flatMap((provider) =>
      provider.descriptor.models.map((model) => ({
        id: provider.descriptor.id,
        model: model.id,
        displayName: `${provider.descriptor.displayName} · ${model.displayName}`,
        default: provider.descriptor.defaultModel === model.id,
        capabilities: model.capabilities,
        ...(model.costPerImage === undefined ? {} : { costPerImage: model.costPerImage }),
        ...(model.currency === undefined ? {} : { currency: model.currency }),
        uploadsUserAssets: provider.descriptor.uploadsUserAssets,
      })),
    );
  }

  private commit(job: ImageJob): ImageJob {
    this.store.saveJob(job);
    this.emit(toTaskEvent(job, this.store));
    return job;
  }

  /** 终态任务不再接受任何状态上报。 */
  private transition(job: ImageJob, patch: Parameters<typeof applyTransition>[1]): ImageJob {
    if (isTerminal(job.status)) return job;
    const next = applyTransition(job, { at: this.now(), ...patch });
    return next === job ? job : this.commit(next);
  }

  private modelOf(job: ImageJob): ProviderModel | undefined {
    return this.providers.get(job.providerId)?.getModel(job.model);
  }

  private async run(jobId: string): Promise<void> {
    const initial = this.store.getJob(jobId);
    const provider = initial ? this.providers.get(initial.providerId) : undefined;
    if (!initial || !provider) return;

    const controller = new AbortController();
    this.runs.set(jobId, { controller });
    let job = this.transition(initial, { status: "submitting" });

    try {
      const submitted = await provider
        .submit(
          {
            model: job.model,
            prompt: job.submittedPrompt,
            referenceAssetIds: job.referenceAssetIds,
            aspectRatio: job.aspectRatio,
            sizeMode: job.sizeMode ?? "ratio",
            ...(job.requestedSize === undefined ? {} : { size: job.requestedSize }),
            count: job.count,
            ...(job.seed === undefined ? {} : { seed: job.seed }),
            ...(job.negativePrompt === undefined ? {} : { negativePrompt: job.negativePrompt }),
          },
          controller.signal,
        )
        .catch((error: unknown) => ({ state: "error" as const, error }));

      if (submitted.state === "error") {
        // 提交失败不自动重试：请求可能已送达上游并计费。用户确认后手动重试。
        if (controller.signal.aborted) return;
        const error: NonNullable<ImageJob["error"]> = isProviderRequestError(submitted.error)
          ? submitted.error.detail
          : { code: "provider-failed", message: `提交失败：${safeMessage(submitted.error)}`, retryable: true };
        job = this.transition(job, { status: "failed", error });
        this.notify({ level: "error", message: `任务失败：${error.message}` });
        return;
      }

      let images: readonly ProviderImage[];
      if (submitted.state === "completed") {
        images = submitted.images;
      } else {
        const polled = await this.pollUntilDone(job, submitted.remoteTaskId, submitted.pollAfterMs, controller);
        if (polled === undefined) return;
        if (polled.kind === "failed") {
          this.transition(polled.job, { status: "failed", error: polled.error });
          this.notify({ level: "error", message: `任务失败：${polled.error.message}` });
          return;
        }
        images = polled.images;
        job = polled.job;
      }

      await this.completeWithImages(job, images);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.transition(job, {
        status: "failed",
        error: { code: "internal", message: `内部错误：${safeMessage(error)}`, retryable: false },
      });
      this.notify({ level: "error", message: `任务失败：${safeMessage(error)}` });
    } finally {
      this.runs.delete(jobId);
    }
  }

  private async pollUntilDone(
    start: ImageJob,
    remoteTaskId: string,
    firstDelayMs: number,
    controller: AbortController,
  ): Promise<
    | undefined
    | { readonly kind: "failed"; readonly job: ImageJob; readonly error: NonNullable<ImageJob["error"]> }
    | { readonly kind: "completed"; readonly job: ImageJob; readonly images: readonly ProviderImage[] }
  > {
    const provider = this.providers.get(start.providerId);
    if (!provider) return undefined;

    let job = this.transition(start, { status: "running", remoteTaskId });
    let failStreak = 0;
    let delayMs = firstDelayMs;

    for (;;) {
      try {
        await delay(delayMs, controller.signal);
      } catch {
        return undefined;
      }

      const polled = await provider.poll(remoteTaskId, controller.signal).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      if (!polled.ok) {
        if (controller.signal.aborted) return undefined;
        failStreak += 1;
        if (failStreak >= MAX_POLL_TRANSIENT_FAILURES) {
          return {
            kind: "failed",
            job,
            error: {
              code: "provider-unavailable",
              message: `查询上游失败：${safeMessage(polled.error)}`,
              retryable: true,
            },
          };
        }
        // 查询失败是安全的可重试错误：不会重复提交生成请求。
        delayMs = Math.max(this.retryDelayMs, 200 * failStreak);
        continue;
      }

      const result = polled.value;
      failStreak = 0;
      if (result.state === "running") {
        delayMs = result.pollAfterMs;
        continue;
      }
      if (result.state === "cancelled") {
        // 上游自己报告已取消（例如有人在上游侧停止）。
        job = this.transition(job, { status: "cancelled", sticky: true });
        return undefined;
      }
      if (result.state === "failed") return { kind: "failed", job, error: result.error };
      return { kind: "completed", job, images: result.images };
    }
  }

  /** `succeeded` 只在图片校验、转码并保存进本地作品库之后才发出。 */
  private async completeWithImages(job: ImageJob, images: readonly ProviderImage[]): Promise<void> {
    if (images.length === 0) {
      this.transition(job, {
        status: "failed",
        error: { code: "provider-failed", message: "上游没有返回任何图片", retryable: true },
      });
      return;
    }

    const format = job.format ?? "png";
    const compression = job.compression ?? 0;

    const assets: ImageAsset[] = [];
    const createdAt = this.now();
    for (const image of images) {
      const validated = validateImage(image, job, createdAt);
      if ("error" in validated) {
        this.transition(job, { status: "failed", error: validated.error });
        return;
      }
      const source = Buffer.from(image.bytes);
      let finalAsset = validated.asset;
      if (format !== "png") {
        try {
          const converted = await transcodeImage({ bytes: source, format, compression });
          finalAsset = {
            ...validated.asset,
            mimeType: converted.mimeType,
            byteLength: converted.bytes.length,
            width: converted.width,
            height: converted.height,
            previewUrl: `data:${converted.mimeType};base64,${converted.bytes.toString("base64")}`,
          };
        } catch (error) {
          this.transition(job, {
            status: "failed",
            error: {
              code: "internal",
              message: `转码为 ${format.toUpperCase()} 失败：${safeMessage(error)}`,
              retryable: false,
            },
          });
          return;
        }
      }
      assets.push(finalAsset);
    }

    for (const asset of assets) this.store.saveAsset(asset);

    const costPerImage = this.modelOf(job)?.costPerImage ?? 0;
    if (job.billableImages > 0 && costPerImage > 0) this.store.addCost(costPerImage * assets.length);
    this.recomputeBudget();

    this.commit(
      applyTransition(
        { ...job, assetIds: assets.map((asset) => asset.id) },
        { status: "succeeded", at: this.now() },
      ),
    );
  }

  private recomputeBudget(): void {
    this.budget = {
      currency: "USD",
      spent: this.store.spent(),
      ...(this.sessionBudget.limit === undefined ? {} : { limit: this.sessionBudget.limit }),
    };
  }

  private budgetStatus(): BudgetStatus {
    return this.budget ?? {
      currency: "USD",
      spent: this.store.spent(),
      ...(this.sessionBudget.limit === undefined ? {} : { limit: this.sessionBudget.limit }),
    };
  }
}

function isTerminal(status: ImageJob["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function safeMessage(error: unknown): string {
  // provider 抛出的结构化错误自带用户可读文案与可重试标记。
  if (isProviderRequestError(error)) return error.detail.message;
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
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

function validateImage(
  image: ProviderImage,
  job: ImageJob,
  createdAt: number,
): { readonly asset: ImageAsset } | { readonly error: NonNullable<ImageJob["error"]> } {
  if (image.mimeType !== "image/png") {
    return {
      error: { code: "provider-failed", message: "返回了不支持的图片类型", retryable: false },
    };
  }
  const bytes = Buffer.from(image.bytes);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return { error: { code: "provider-failed", message: "返回图片为空或超出大小限制", retryable: false } };
  }
  let size: { width: number; height: number };
  try {
    size = readPngSize(bytes);
  } catch {
    return { error: { code: "provider-failed", message: "返回的内容不是合法 PNG", retryable: false } };
  }
  return {
    asset: {
      id: `asset-${randomUUID()}`,
      jobId: job.id,
      providerId: job.providerId,
      model: job.model,
      mimeType: "image/png",
      byteLength: bytes.length,
      width: size.width,
      height: size.height,
      prompt: job.prompt,
      ...(job.agentPrompt === undefined ? {} : { agentPrompt: job.agentPrompt }),
      previewUrl: `data:image/png;base64,${bytes.toString("base64")}`,
      createdAt,
    },
  };
}
