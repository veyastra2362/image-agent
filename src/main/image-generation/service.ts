/**
 * 任务编排：校验 → 排队 → 提交 → 轮询 → 保存结果。
 *
 * 这里不包含任何厂商协议细节；所有网络/格式工作都在 provider adapter 里完成。
 * 所有输入都来自 IPC 或网络，一律先校验再做任何副作用。
 */
import { randomUUID } from "node:crypto";
import {
  applyTransition,
  checkCapabilities,
  validateCreateJobInput,
  validateJobId,
  resolveRatioSize,
  type AspectRatio,
  type ImageAsset,
  type ImageBootstrap,
  type ImageJob,
  type ImageRequestResult,
  type ImageTaskEvent,
  type Notification,
  type OptimizePromptResult,
  type UploadReferenceResult,
  type ProviderRef,
} from "@shared/image-generation";
import { validateImagePlan, type PlanResult } from "@shared/image-plan";
import { readPngSize } from "./fixtures";

/** data:image/png;base64,… → 字节。 */
function decodeDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const base64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  return new Uint8Array(Buffer.from(base64, "base64"));
}
import { transcodeImage } from "./transcode";
import { isProviderRequestError } from "./provider";
import type { ImageProvider, ProviderImage, ProviderModel } from "./provider";
import type { JobStore } from "./store";
import { toTaskEvent } from "./store";

export interface ServiceDependencies {
  readonly providers: readonly ImageProvider[];
  /** 语言模型 provider：目前只用于改写提示词。 */
  readonly agentProviders?: readonly ImageProvider[];
  readonly store: JobStore;
  readonly emit: (event: ImageTaskEvent) => void;
  readonly notify: (notification: Notification) => void;
  readonly now?: () => number;
  readonly newId?: () => string;
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
/** 参考图上限：10MB（base64 后约 13.3MB）。 */
const MAX_REFERENCE_MB = 10;
const MAX_REFERENCE_BYTES = MAX_REFERENCE_MB * 1024 * 1024;
const MAX_REFERENCE_BASE64 = Math.ceil(MAX_REFERENCE_BYTES / 3) * 4;

export class ImageGenerationService {
  /**
   * provider 表在运行中可以被整体替换：用户在设置里改了地址/密钥/模型之后，
   * main 会重建这张表，而不需要重启应用。进行中的任务仍持有旧的 provider 实例，
   * 因此不会被中途换掉。
   */
  private providers: Map<string, ImageProvider>;
  private agentProviders = new Map<string, ImageProvider>();
  private readonly store: JobStore;
  private readonly emit: (event: ImageTaskEvent) => void;
  private readonly notify: (notification: Notification) => void;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly retryDelayMs: number;
  private readonly runs = new Map<string, ActiveRun>();

  constructor(deps: ServiceDependencies) {
    this.providers = new Map(deps.providers.map((provider) => [provider.descriptor.id, provider]));
    this.agentProviders = new Map((deps.agentProviders ?? []).map((provider) => [provider.descriptor.id, provider]));
    this.store = deps.store;
    this.emit = deps.emit;
    this.notify = deps.notify;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => `job-${randomUUID()}`);
    this.retryDelayMs = deps.retryDelayMs ?? 0;
  }

  /** 换掉整张 provider 表。之后的新任务用新实例，旧任务不受影响。 */
  setProviders(providers: readonly ImageProvider[]): void {
    this.providers = new Map(providers.map((provider) => [provider.descriptor.id, provider]));
  }

  setAgentProviders(providers: readonly ImageProvider[]): void {
    this.agentProviders = new Map(providers.map((provider) => [provider.descriptor.id, provider]));
  }

  getBootstrap(): ImageBootstrap {
    return {
      providers: this.providerRefs(),
      agentAvailable: this.agentProviders.size > 0,
      jobs: this.store.listJobs().map((job) => toTaskEvent(job, this.store)),
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
      ...(input.maskDataUrl === undefined ? {} : { hasMask: true }),
      uploadsUserAssets: provider.descriptor.uploadsUserAssets && input.referenceAssetIds.length > 0,
      aspectRatio,
      sizeMode,
      ...(requestedSize === undefined ? {} : { requestedSize }),
      format,
      compression,
      count: input.count,
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      ...(input.negativePrompt === undefined ? {} : { negativePrompt: input.negativePrompt }),

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

  /**
   * 接收 renderer 上传的参考图：只允许 png/jpeg/webp，统一转成 PNG 落库，
   * 返回 assetId 供 createJob 引用。任何一步失败都明确报错，不落半张图。
   */
  async uploadReference(raw: unknown): Promise<UploadReferenceResult> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: { code: "invalid-request", message: "参考图格式不正确", retryable: false } };
    }
    const record = raw as Record<string, unknown>;
    const dataBase64 = record.dataBase64;
    const mimeType = record.mimeType;
    if (typeof dataBase64 !== "string" || dataBase64.length === 0) {
      return { ok: false, error: { code: "invalid-request", message: "缺少图片数据", retryable: false } };
    }
    if (dataBase64.length > MAX_REFERENCE_BASE64) {
      return { ok: false, error: { code: "invalid-request", message: `参考图不能超过 ${MAX_REFERENCE_MB}MB`, retryable: false } };
    }
    if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") {
      return { ok: false, error: { code: "invalid-request", message: "只支持 PNG / JPEG / WebP", retryable: false } };
    }

    let source: Buffer;
    try {
      source = Buffer.from(dataBase64, "base64");
    } catch {
      return { ok: false, error: { code: "invalid-request", message: "图片数据无法解码", retryable: false } };
    }
    if (source.length === 0 || source.length > MAX_REFERENCE_BYTES) {
      return { ok: false, error: { code: "invalid-request", message: `参考图不能超过 ${MAX_REFERENCE_MB}MB`, retryable: false } };
    }

    let converted: { bytes: Buffer; mimeType: string; width: number; height: number };
    try {
      converted = await transcodeImage({ bytes: source, format: "png", compression: 0 });
    } catch (error) {
      return {
        ok: false,
        error: { code: "invalid-request", message: `无法解析这张图片：${safeMessage(error)}`, retryable: false },
      };
    }

    const createdAt = this.now();
    const asset = this.store.saveAsset(
      {
        id: `ref-${randomUUID()}`,
        jobId: "reference",
        providerId: "local",
        model: "upload",
        mimeType: "image/png",
        byteLength: converted.bytes.length,
        width: converted.width,
        height: converted.height,
        prompt: "参考图",
        previewUrl: "",
        createdAt,
      },
      converted.bytes,
    );
    return { ok: true, assetId: asset.id, width: asset.width, height: asset.height };
  }

  /** Agent 优化提示词：交给对应服务商的 chat 接口改写。 */
  async optimizePrompt(raw: unknown): Promise<OptimizePromptResult> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: { code: "invalid-request", message: "请求格式不正确", retryable: false } };
    }
    const record = raw as Record<string, unknown>;
    const prompt = record.prompt;
    const model = record.model;
    if (typeof prompt !== "string" || prompt.trim() === "") {
      return { ok: false, error: { code: "invalid-request", message: "请先写好提示词", retryable: false } };
    }
    // 语言模型是独立配置：不要求调用方指定 providerId，用当前选中的那条。
    const requestedId = typeof record.providerId === "string" ? record.providerId : "";
    const agentProvider = this.agentProviders.get(requestedId) ?? this.agentProviders.values().next().value;
    if (agentProvider === undefined) {
      return {
        ok: false,
        error: {
          code: "unsupported-capability",
          message: "还没有配置语言模型：请在 设置 → API 设置 → 语言模型 里添加",
          retryable: false,
        },
      };
    }
    const provider = agentProvider;
    const optimize = (provider as { optimizePrompt?: (p: string, m: string, s: AbortSignal) => Promise<string> })
      .optimizePrompt;
    if (typeof optimize !== "function") {
      return {
        ok: false,
        error: { code: "unsupported-capability", message: "该服务商不支持提示词优化", retryable: false },
      };
    }
    const chatModel =
      typeof model === "string" && model.length > 0
        ? model
        : provider.descriptor.defaultModel;
    const controller = new AbortController();
    try {
      const rewritten = await optimize.call(provider, prompt, chatModel, controller.signal);
      return { ok: true, prompt: rewritten };
    } catch (error) {
      return {
        ok: false,
        error: { code: "provider-failed", message: safeMessage(error), retryable: true },
      };
    }
  }

  /** Agent Planner：把提示词规划成结构化 ImagePlan（校验后才交给界面）。 */
  async planPrompt(raw: unknown): Promise<PlanResult> {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "请求格式不正确" };
    const record = raw as Record<string, unknown>;
    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
    if (prompt === "") return { ok: false, error: "请先写好提示词" };

    const agentProvider = this.agentProviders.values().next().value as ImageProvider | undefined;
    if (agentProvider === undefined) {
      return { ok: false, error: "还没有配置语言模型：请在 设置 → API 设置 → 语言模型 里添加" };
    }
    const plan = (agentProvider as { planImage?: (p: string, m: string, s: AbortSignal) => Promise<string> })
      .planImage;
    if (typeof plan !== "function") {
      return { ok: false, error: "该服务商不支持 Agent 规划" };
    }

    try {
      const raw = await plan.call(agentProvider, prompt, agentProvider.descriptor.defaultModel, new AbortController().signal);
      return validateImagePlan(raw);
    } catch (error) {
      return { ok: false, error: `规划失败：${safeMessage(error)}` };
    }
  }

  /** 重试：按历史任务的原参数再提交一次（含改写提示词与参考图）。 */
  async retryJob(raw: unknown): Promise<ServiceResult> {
    if (typeof raw !== "string" || raw.trim() === "") {
      return { ok: false, error: { code: "invalid-request", message: "缺少任务 ID", retryable: false } };
    }
    const job = this.store.getJob(raw);
    if (job === undefined) {
      return { ok: false, error: { code: "invalid-request", message: "这个任务不在了", retryable: false } };
    }
    return this.createJob({
      requestId: `retry-${randomUUID()}`,
      providerId: job.providerId,
      model: job.model,
      prompt: job.prompt,
      ...(job.agentPrompt === undefined ? {} : { agentPrompt: job.agentPrompt }),
      referenceAssetIds: job.referenceAssetIds,
      aspectRatio: job.aspectRatio,
      count: job.count,
      ...(job.seed === undefined ? {} : { seed: job.seed }),
      ...(job.negativePrompt === undefined ? {} : { negativePrompt: job.negativePrompt }),
      sizeMode: job.sizeMode ?? "ratio",
      // 只有自定义模式才带宽高；比例模式的宽高是推导出来的，传了会被校验拒绝。
      ...(job.sizeMode !== "custom" || job.requestedSize === undefined
        ? {}
        : { width: job.requestedSize.width, height: job.requestedSize.height }),
      format: job.format,
      compression: job.compression,
    });
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
        providerDisplayName: provider.descriptor.displayName,
        modelDisplayName: model.displayName,
        default: provider.descriptor.defaultModel === model.id,
        capabilities: model.capabilities,
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

    // 参考图字节在这里读出来交给 adapter：adapter 不接触本地文件系统，也不认识 asset ID。
    const referenceImages = job.referenceAssetIds
      .map((assetId) => {
        const asset = this.store.getAsset(assetId);
        const bytes = this.store.bytesForAsset(assetId);
        return asset === undefined || bytes === undefined ? undefined : { bytes, mimeType: asset.mimeType };
      })
      .filter((entry): entry is { bytes: Uint8Array; mimeType: string } => entry !== undefined);

    try {
      const submitted = await provider
        .submit(
          {
            model: job.model,
            prompt: job.submittedPrompt,
            referenceAssetIds: job.referenceAssetIds,
            ...(referenceImages.length === 0 ? {} : { referenceImages }),
            ...(job.maskDataUrl === undefined
              ? {}
              : { mask: { bytes: decodeDataUrl(job.maskDataUrl), mimeType: "image/png" } }),
            aspectRatio: job.aspectRatio,
            sizeMode: job.sizeMode ?? "ratio",
            ...(job.requestedSize === undefined ? {} : { size: job.requestedSize }),
            count: job.count,
            ...(job.seed === undefined ? {} : { seed: job.seed }),
            ...(job.negativePrompt === undefined ? {} : { negativePrompt: job.negativePrompt }),
            // 流式 provider：收到中间图就更新一次任务，界面能看到"已收到 N 张"。
            onPartialImage: ({ index }: { readonly index: number }) => {
              const current = this.store.getJob(job.id);
              if (current === undefined || current.partialImages === index) return;
              job = this.commit({ ...current, partialImages: index, updatedAt: this.now() });
            },
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

    const pending: { asset: ImageAsset; bytes: Uint8Array }[] = [];
    const createdAt = this.now();
    for (const image of images) {
      const validated = validateImage(image, job, createdAt);
      if ("error" in validated) {
        this.transition(job, { status: "failed", error: validated.error });
        return;
      }
      const source = Buffer.from(image.bytes);
      let finalAsset = validated.asset;
      let finalBytes: Uint8Array = image.bytes;
      if (format !== "png") {
        try {
          const converted = await transcodeImage({ bytes: source, format, compression });
          finalBytes = converted.bytes;
          finalAsset = {
            ...validated.asset,
            mimeType: converted.mimeType,
            byteLength: converted.bytes.length,
            width: converted.width,
            height: converted.height,
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
      pending.push({ asset: finalAsset, bytes: finalBytes });
    }

    // 由存储决定最终的 previewUrl（写盘后指向文件，内存实现用 data URL）。
    const assets = pending.map((entry) => this.store.saveAsset(entry.asset, entry.bytes));

    // 有的网关会悄悄忽略 size（返回自己的默认尺寸），这里如实提示，而不是假装成功。
    const requested = job.requestedSize;
    if (requested !== undefined) {
      const off = assets.find((asset) => asset.width !== requested.width || asset.height !== requested.height);
      if (off !== undefined) {
        this.notify({
          level: "warning",
          message: `上游返回 ${off.width}×${off.height}，与请求的 ${requested.width}×${requested.height} 不一致`,
        });
      }
    }

    this.commit(
      applyTransition(
        { ...job, assetIds: assets.map((asset) => asset.id) },
        { status: "succeeded", at: this.now() },
      ),
    );
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
      // 预览地址由存储决定；这里先留空。
      previewUrl: "",
      createdAt,
    },
  };
}
