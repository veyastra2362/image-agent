/**
 * IPC 边界上的图像任务、能力、事件与校验类型。
 *
 * 这个文件同时被 main、renderer 和 node:test 引用。它只能有类型和纯函数，
 * 不得导入 Node、Electron 或 DOM API。所有跨 IPC / 网络的数据都先按 `unknown`
 * 接收，再在这里校验。
 */

export const JOB_STATUSES = [
  "queued",
  "submitting",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

export const ASPECT_RATIOS = [
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
  "custom",
] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** 用户可选的预设比例（不含"自定义"）。 */
export const PRESET_RATIOS = ASPECT_RATIOS.filter((ratio): ratio is Exclude<AspectRatio, "custom"> => ratio !== "custom");

/** 分辨率档位：只表达"短边目标像素"，具体宽高由比例推导。 */
export const RESOLUTION_TIERS = [1024, 1536, 2048, 4096] as const;

export type ResolutionTier = (typeof RESOLUTION_TIERS)[number];

export const OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** 压缩率：0 = 画质优先，100 = 体积优先。只对 jpeg/webp 生效。 */
export const COMPRESSION_MIN = 0;
export const COMPRESSION_MAX = 100;

export const SIZE_MODE_AUTO = "auto";

/**
 * 画面模式：
 *   auto   —— 不指定尺寸，由模型/上游自己决定（此时比例、分辨率都不参与请求）
 *   ratio  —— 按比例 + 分辨率档位推导出宽高
 *   custom —— 用户直接给宽高
 */
export type SizeMode = "auto" | "ratio" | "custom";

export const MAX_IMAGE_EDGE = 8192;
export const MIN_IMAGE_EDGE = 64;

export interface OutputSpec {
  readonly mode: SizeMode;
  /** mode = "ratio" 时有意义；"custom" 时为自定义比例的规范化写法。 */
  readonly aspectRatio: AspectRatio;
  /** mode = "ratio" 时的短边像素目标；"auto"/"custom" 时不参与。 */
  readonly resolution: ResolutionTier;
  /** mode = "custom" 时的最终宽高。 */
  readonly width?: number;
  readonly height?: number;
  readonly format: OutputFormat;
  readonly compression: number;
}

export interface ImageCapabilities {
  readonly textToImage: boolean;
  readonly imageToImage: boolean;
  readonly masks: boolean;
  readonly referenceImageLimit: number;
  readonly aspectRatios: readonly AspectRatio[];
  readonly outputCountLimit: number;
  readonly seed: boolean;
  readonly negativePrompt: boolean;
  readonly async: boolean;
  readonly cancel: boolean;
  /** 上游是否接受"由模型自己决定尺寸"。为 false 时 auto 会退化成按比例。 */
  readonly autoSize: boolean;
  /** 上游是否接受自定义宽高。为 false 时自定义退化成按比例。 */
  readonly customSize: boolean;
  /** 上游接受的固定尺寸；为空表示按比例自由推导。 */
  readonly sizes: readonly string[];
  /** 本次生成是否由本机负责转码成 jpeg/webp（fake provider 为 false）。 */
  readonly transcode: boolean;
}

/**
 * 按比例与短边目标推导宽高，两边都对齐到 8 的倍数（多数模型要求）。
 * auto/未知比例返回 undefined。
 */
export function resolveRatioSize(ratio: AspectRatio, resolution: number): { width: number; height: number } | undefined {
  const parts = /^(\d{1,2}):(\d{1,2})$/.exec(ratio);
  if (!parts) return undefined;
  const w = Number(parts[1]);
  const h = Number(parts[2]);
  if (w <= 0 || h <= 0) return undefined;
  const short = Math.max(MIN_IMAGE_EDGE, Math.min(MAX_IMAGE_EDGE, Math.round(resolution)));
  const align = (value: number) => Math.round(value / 8) * 8;
  // 长边按短边比例放大，保证短边等于档位值。
  return w >= h
    ? { width: align(Math.round((short * w) / h)), height: align(short) }
    : { width: align(short), height: align(Math.round((short * h) / w)) };
}

/** 解析用户输入的自定义比例（允许 "16:10"、"16/10"、"1.6"）；不合法返回 undefined。 */
export function parseCustomRatio(raw: string): { readonly ratio: AspectRatio; readonly label: string } | undefined {
  const text = raw.trim().replace(/：/g, ":");
  const pair = /^(\d{1,3}(?:\.\d+)?)\s*[:/]\s*(\d{1,3}(?:\.\d+)?)$/.exec(text);
  let w: number;
  let h: number;
  if (pair) {
    w = Number(pair[1]);
    h = Number(pair[2]);
  } else if (/^\d+(?:\.\d+)?$/.test(text)) {
    w = Number(text);
    h = 1;
  } else {
    return undefined;
  }
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
  if (w / h > 20 || h / w > 20) return undefined;
  return { ratio: "custom", label: `${round(w)}:${round(h)}` };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 自定义比例 + 分辨率档位推导宽高（以短边为基准）。 */
export function resolveCustomRatioSize(ratioLabel: string, resolution: number): { width: number; height: number } | undefined {
  const parsed = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratioLabel);
  if (!parsed) return undefined;
  const w = Number(parsed[1]);
  const h = Number(parsed[2]);
  const align = (value: number) => Math.round(value / 8) * 8;
  const short = Math.max(MIN_IMAGE_EDGE, Math.min(MAX_IMAGE_EDGE, Math.round(resolution)));
  return w >= h
    ? { width: align(Math.round((short * w) / h)), height: align(short) }
    : { width: align(short), height: align(Math.round((short * h) / w)) };
}

/** 界面统一显示的一句"将使用 WxH"，auto 时给出可读说明。 */
export function describeOutputSize(spec: OutputSpec, customRatioLabel?: string): string {
  if (spec.mode === "auto") return "由模型自行决定尺寸";
  if (spec.mode === "custom") {
    return spec.width && spec.height ? `将使用 ${spec.width}×${spec.height}` : "自定义尺寸不完整";
  }
  if (spec.aspectRatio === "custom") {
    const size = customRatioLabel ? resolveCustomRatioSize(customRatioLabel, spec.resolution) : undefined;
    return size ? `将使用 ${size.width}×${size.height}` : "自定义比例不合法";
  }
  const size = resolveRatioSize(spec.aspectRatio, spec.resolution);
  return size ? `将使用 ${size.width}×${size.height}` : "比例不合法";
}

export const ERROR_CODES = [
  "invalid-request",
  "unknown-provider",
  "unknown-model",
  "unsupported-capability",
  "reference-not-found",
  "job-not-found",
  "provider-unavailable",
  "provider-failed",
  "cancelled",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ImageError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ProviderRef {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  /** 服务商显示名，模型选择器按它分组。 */
  readonly providerDisplayName: string;
  /** 模型显示名（不含服务商前缀）。 */
  readonly modelDisplayName: string;
  readonly default: boolean;
  /** 模型级能力。UI 只显示这里声明支持的参数。 */
  readonly capabilities: ImageCapabilities;
  /** 参考图是否会上传离开本机；UI 在提交前提示用户。 */
  readonly uploadsUserAssets: boolean;
}

export interface CreateImageJobInput {
  /** 客户端生成的请求键。同一键重复提交返回同一个任务，renderer 重试不会重复建任务。 */
  readonly requestId: string;
  readonly providerId: string;
  /** 省略时使用 provider 的默认模型。不可信输入，main 负责校验。 */
  readonly model?: string;
  /** 未加工的提示词，原样保存。 */
  readonly prompt: string;
  /** 用户确认过的改写提示词；没有改写时省略。 */
  readonly agentPrompt?: string;
  /** 本地参考图 asset ID；renderer 永远不传磁盘路径。 */
  readonly referenceAssetIds: readonly string[];
  readonly aspectRatio?: AspectRatio;
  readonly count: number;
  readonly seed?: number;
  readonly negativePrompt?: string;
  /** 画面尺寸来源：auto / 比例 / 自定义。省略时按比例处理。 */
  readonly sizeMode?: SizeMode;
  /** 自定义宽高（sizeMode = "custom" 时必填）。 */
  readonly width?: number;
  readonly height?: number;
  readonly format?: OutputFormat;
  readonly compression?: number;
}

export interface AgentRunRecord {
  readonly planner: string;
  readonly useRewrittenPrompt: boolean;
  readonly instruction: string;
}

export interface ImageJob {
  readonly id: string;
  readonly requestId: string;
  readonly providerId: string;
  readonly providerDisplayName: string;
  readonly model: string;
  readonly modelDisplayName: string;
  readonly status: JobStatus;
  readonly prompt: string;
  readonly agentPrompt?: string;
  /** 实际发给 provider 的提示词。 */
  readonly submittedPrompt: string;
  /** 提交时的能力快照，用于详情展示与复现。 */
  readonly capabilities: ImageCapabilities;
  readonly referenceAssetIds: readonly string[];
  /** 当参考图需要上传给远端 provider 时为 true；本地 fake provider 为 false。 */
  readonly uploadsUserAssets: boolean;
  readonly aspectRatio: AspectRatio;
  /** 实际使用的尺寸模式；老记录没有这个字段，按 "ratio" 理解。 */
  readonly sizeMode?: SizeMode;
  /** 请求的最终宽高（auto 时省略）。 */
  readonly requestedSize?: { readonly width: number; readonly height: number };
  readonly format?: OutputFormat;
  readonly compression?: number;
  readonly count: number;
  readonly seed?: number;
  readonly negativePrompt?: string;
  readonly agentRun?: AgentRunRecord;
  readonly attempts: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly remoteTaskId?: string;
  readonly assetIds: readonly string[];
  readonly error?: ImageError;
}

export interface ImageAsset {
  readonly id: string;
  readonly jobId: string;
  readonly providerId: string;
  readonly model: string;
  /** 落库时的实际编码格式（main 负责转码；fake provider 固定 png）。 */
  readonly mimeType: string;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly prompt: string;
  readonly agentPrompt?: string;
  /** content: URL；只在 renderer 中用于展示，不写出磁盘。 */
  readonly previewUrl: string;
  readonly createdAt: number;
}

export interface ImageTaskEvent {
  readonly job: ImageJob;
  readonly assets: readonly ImageAsset[];
}

export interface Notification {
  readonly level: "info" | "warning" | "error";
  readonly message: string;
}

export interface ImageBootstrap {
  readonly providers: readonly ProviderRef[];
  readonly jobs: readonly ImageTaskEvent[];
}

export type Unsubscribe = () => void;

/** main 对"创建/取消任务"这类请求的返回形状；失败是可判别结果，不是异常。 */
export type ImageRequestResult =
  | { readonly ok: true; readonly event: ImageTaskEvent }
  | { readonly ok: false; readonly error: ImageError };

export interface ImageAgentApi {
  readonly getBootstrap: () => Promise<ImageBootstrap>;
  readonly createJob: (input: unknown) => Promise<ImageRequestResult>;
  readonly cancelJob: (jobId: string) => Promise<ImageRequestResult>;
  readonly onTaskEvent: (listener: (event: ImageTaskEvent) => void) => Unsubscribe;
  readonly onNotification: (listener: (notification: Notification) => void) => Unsubscribe;
}

// ---------------------------------------------------------------------------
// 校验结果
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ImageError };

function fail(code: ErrorCode, message: string, retryable = false): { ok: false; error: ImageError } {
  return { ok: false, error: { code, message, retryable } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ALLOWED_INPUT_KEYS = new Set([
  "requestId",
  "providerId",
  "model",
  "prompt",
  "agentPrompt",
  "referenceAssetIds",
  "aspectRatio",
  "count",
  "seed",
  "negativePrompt",
  "sizeMode",
  "width",
  "height",
  "format",
  "compression",
]);

export const LIMITS = {
  promptMaxLength: 2000,
  agentPromptMaxLength: 2000,
  negativePromptMaxLength: 1000,
  idMaxLength: 64,
  requestIdMaxLength: 128,
  modelMaxLength: 128,
  maxOutputCount: 4,
  maxReferenceImages: 4,
  seedMax: 2_147_483_647,
  /** 自定义宽高允许范围；与 MAX_IMAGE_EDGE / MIN_IMAGE_EDGE 一致。 */
  edgeMin: MIN_IMAGE_EDGE,
  edgeMax: MAX_IMAGE_EDGE,
} as const;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

/** 去首尾空白并按 Unicode 码点计数，避免代理对把长度算多。 */
function promptLength(text: string): number {
  return [...text].length;
}

/**
 * 校验 "未知数量的跨 IPC 数据" 的表单字段。
 *
 * renderer 会在发送前调用它改善体验；main 必须再调用一次，因为 renderer 不是安全边界。
 */
export function validateCreateJobInput(raw: unknown): ValidationResult<CreateImageJobInput> {
  if (!isRecord(raw)) return fail("invalid-request", "请求格式不正确：应为对象");

  const unknownKeys = Object.keys(raw).filter((key) => !ALLOWED_INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return fail("invalid-request", `请求包含未知字段：${unknownKeys.join(", ")}`);
  }

  const requestId = raw.requestId;
  if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) {
    return fail("invalid-request", "requestId 必须是由字母、数字和连字符组成的 8–128 位字符串");
  }

  const providerId = raw.providerId;
  if (typeof providerId !== "string" || providerId.length === 0 || providerId.length > LIMITS.idMaxLength) {
    return fail("invalid-request", "providerId 不合法");
  }

  let model: string | undefined;
  if (raw.model !== undefined) {
    if (typeof raw.model !== "string" || raw.model.trim().length === 0 || raw.model.length > LIMITS.modelMaxLength) {
      return fail("invalid-request", "model 不合法");
    }
    model = raw.model.trim();
  }

  if (typeof raw.prompt !== "string") return fail("invalid-request", "prompt 必须是字符串");
  const prompt = raw.prompt.trim();
  if (prompt.length === 0) return fail("invalid-request", "提示词不能为空");
  if (promptLength(prompt) > LIMITS.promptMaxLength) {
    return fail("invalid-request", `提示词不能超过 ${LIMITS.promptMaxLength} 个字符`);
  }

  let agentPrompt: string | undefined;
  if (raw.agentPrompt !== undefined) {
    if (typeof raw.agentPrompt !== "string") return fail("invalid-request", "agentPrompt 必须是字符串");
    const trimmed = raw.agentPrompt.trim();
    if (trimmed.length === 0 || promptLength(trimmed) > LIMITS.agentPromptMaxLength) {
      return fail("invalid-request", `改写提示词长度必须在 1–${LIMITS.agentPromptMaxLength} 之间`);
    }
    agentPrompt = trimmed;
  }

  const referenceAssetIds: string[] = [];
  if (raw.referenceAssetIds !== undefined) {
    if (!Array.isArray(raw.referenceAssetIds)) return fail("invalid-request", "referenceAssetIds 必须是数组");
    if (raw.referenceAssetIds.length > LIMITS.maxReferenceImages) {
      return fail("invalid-request", `参考图最多 ${LIMITS.maxReferenceImages} 张`);
    }
    for (const id of raw.referenceAssetIds) {
      if (typeof id !== "string" || id.length > LIMITS.idMaxLength || !ID_PATTERN.test(id)) {
        return fail("invalid-request", "参考图 asset ID 格式不合法");
      }
      if (referenceAssetIds.includes(id)) return fail("invalid-request", "参考图不能重复");
      referenceAssetIds.push(id);
    }
  }

  let aspectRatio: AspectRatio | undefined;
  if (raw.aspectRatio !== undefined) {
    if (typeof raw.aspectRatio !== "string" || !(ASPECT_RATIOS as readonly string[]).includes(raw.aspectRatio)) {
      return fail("invalid-request", `不支持的画面比例：${String(raw.aspectRatio)}`);
    }
    aspectRatio = raw.aspectRatio as AspectRatio;
  }

  if (typeof raw.count !== "number" || !Number.isInteger(raw.count)) {
    return fail("invalid-request", "count 必须是整数");
  }
  if (raw.count < 1 || raw.count > LIMITS.maxOutputCount) {
    return fail("invalid-request", `生成数量必须在 1–${LIMITS.maxOutputCount} 之间`);
  }

  let seed: number | undefined;
  if (raw.seed !== undefined) {
    if (typeof raw.seed !== "number" || !Number.isInteger(raw.seed) || raw.seed < 0 || raw.seed > LIMITS.seedMax) {
      return fail("invalid-request", `seed 必须是 0–${LIMITS.seedMax} 的整数`);
    }
    seed = raw.seed;
  }

  let negativePrompt: string | undefined;
  if (raw.negativePrompt !== undefined) {
    if (typeof raw.negativePrompt !== "string") return fail("invalid-request", "negativePrompt 必须是字符串");
    const trimmed = raw.negativePrompt.trim();
    if (trimmed.length > 0) {
      if (promptLength(trimmed) > LIMITS.negativePromptMaxLength) {
        return fail("invalid-request", `负面提示词不能超过 ${LIMITS.negativePromptMaxLength} 个字符`);
      }
      negativePrompt = trimmed;
    }
  }

  let sizeMode: SizeMode | undefined;
  if (raw.sizeMode !== undefined) {
    if (raw.sizeMode !== "auto" && raw.sizeMode !== "ratio" && raw.sizeMode !== "custom") {
      return fail("invalid-request", `不支持的尺寸模式：${String(raw.sizeMode)}`);
    }
    sizeMode = raw.sizeMode;
  }

  const parseEdge = (name: string): { value?: number } | { error: string } => {
    const input = raw[name];
    if (input === undefined) return {};
    if (
      typeof input !== "number" ||
      !Number.isInteger(input) ||
      input < LIMITS.edgeMin ||
      input > LIMITS.edgeMax
    ) {
      return { error: `${name} 必须是 ${LIMITS.edgeMin}–${LIMITS.edgeMax} 的整数` };
    }
    return { value: input };
  };
  const widthResult = parseEdge("width");
  if ("error" in widthResult) return fail("invalid-request", widthResult.error);
  const heightResult = parseEdge("height");
  if ("error" in heightResult) return fail("invalid-request", heightResult.error);

  if (sizeMode === "custom" && (widthResult.value === undefined || heightResult.value === undefined)) {
    return fail("invalid-request", "自定义尺寸必须同时给出宽和高");
  }
  if (sizeMode !== "custom" && (widthResult.value !== undefined || heightResult.value !== undefined)) {
    return fail("invalid-request", "只有自定义尺寸模式可以带宽高");
  }

  let format: OutputFormat | undefined;
  if (raw.format !== undefined) {
    if (typeof raw.format !== "string" || !(OUTPUT_FORMATS as readonly string[]).includes(raw.format)) {
      return fail("invalid-request", `不支持的输出格式：${String(raw.format)}`);
    }
    format = raw.format as OutputFormat;
  }

  let compression: number | undefined;
  if (raw.compression !== undefined) {
    if (
      typeof raw.compression !== "number" ||
      !Number.isInteger(raw.compression) ||
      raw.compression < COMPRESSION_MIN ||
      raw.compression > COMPRESSION_MAX
    ) {
      return fail("invalid-request", `压缩率必须是 ${COMPRESSION_MIN}–${COMPRESSION_MAX} 的整数`);
    }
    compression = raw.compression;
  }

  return {
    ok: true,
    value: {
      requestId,
      providerId,
      ...(model === undefined ? {} : { model }),
      prompt,
      ...(agentPrompt === undefined ? {} : { agentPrompt }),
      referenceAssetIds,
      ...(aspectRatio === undefined ? {} : { aspectRatio }),
      count: raw.count,
      ...(seed === undefined ? {} : { seed }),
      ...(negativePrompt === undefined ? {} : { negativePrompt }),
      ...(sizeMode === undefined ? {} : { sizeMode }),
      ...(widthResult.value === undefined ? {} : { width: widthResult.value }),
      ...(heightResult.value === undefined ? {} : { height: heightResult.value }),
      ...(format === undefined ? {} : { format }),
      ...(compression === undefined ? {} : { compression }),
    },
  };
}

/** IPC 只允许传入任务 ID 字符串；其他任何形状都拒绝。 */
export function validateJobId(raw: unknown): ValidationResult<string> {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > LIMITS.idMaxLength || !ID_PATTERN.test(raw)) {
    return fail("invalid-request", "任务 ID 不合法");
  }
  return { ok: true, value: raw };
}

// ---------------------------------------------------------------------------
// 能力校验与状态映射（纯逻辑）

// ---------------------------------------------------------------------------
// 能力校验与状态映射（纯逻辑）
// ---------------------------------------------------------------------------

export interface CapabilityCheckInput {
  readonly capabilities: ImageCapabilities;
  readonly referenceCount: number;
  readonly aspectRatio: AspectRatio;
  readonly count: number;
  readonly seed?: number;
  readonly negativePrompt?: string;
  /** 尺寸模式；缺省视为 "ratio"。 */
  readonly sizeMode?: SizeMode;
  /** 请求的最终宽高（auto 时省略）。 */
  readonly requestedSize?: { readonly width: number; readonly height: number };
}

/** 返回第一条违反能力的用户可读原因；通过时返回 null。 */
export function checkCapabilities(input: CapabilityCheckInput): string | null {
  const caps = input.capabilities;
  if (input.referenceCount > 0) {
    if (!caps.imageToImage) return "当前模型不支持参考图/图生图";
    if (input.referenceCount > caps.referenceImageLimit) {
      return `当前模型最多接受 ${caps.referenceImageLimit} 张参考图`;
    }
  }
  if (!caps.aspectRatios.includes(input.aspectRatio)) {
    return `当前模型不支持 ${input.aspectRatio} 比例`;
  }
  if (input.count > caps.outputCountLimit) {
    return `当前模型单次最多生成 ${caps.outputCountLimit} 张`;
  }
  if (input.seed !== undefined && !caps.seed) return "当前模型不支持固定 seed";
  if (input.negativePrompt !== undefined && !caps.negativePrompt) return "当前模型不支持负面提示词";
  if (input.sizeMode === "auto" && !caps.autoSize) return "当前模型不支持由模型自行决定尺寸，请选择比例";
  if (input.sizeMode === "custom") {
    if (!caps.customSize) return "当前模型不支持自定义宽高，请选择比例";
    if (input.requestedSize === undefined) return "自定义尺寸缺少宽高";
  }
  return null;
}

const TIMESTAMPED = new Set<JobStatus>(["submitting", "running", "succeeded", "failed", "cancelled"]);

/** 允许的不可逆状态转移。终态不再接受任何转移（重复事件的幂等在 normalizeTransition 里处理）。 */
const ALLOWED_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ["queued", "submitting", "cancelled"],
  submitting: ["submitting", "running", "succeeded", "failed", "cancelled"],
  running: ["running", "succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export type TransitionOutcome =
  /** 状态与原记录一致：更新字段但不变更状态，不重复触发副作用。 */
  | { readonly kind: "same" }
  | { readonly kind: "applied" }
  /** 从终态流向其他状态（乱序/迟到的重复事件）：忽略。 */
  | { readonly kind: "ignored"; readonly reason: string }
  /** 同一条记录内的非法转移（如 running → queued）：上游 bug 或损坏数据。 */
  | { readonly kind: "invalid"; readonly reason: string };

export function classifyTransition(from: JobStatus, to: JobStatus): TransitionOutcome {
  if (from === to) return { kind: "same" };
  if (TERMINAL_STATUSES.includes(from)) {
    return { kind: "ignored", reason: `任务已是终态 ${from}，忽略迟到的 ${to} 事件` };
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return { kind: "invalid", reason: `不允许的状态转移 ${from} → ${to}` };
  }
  return { kind: "applied" };
}

export interface StatusTransition {
  readonly status: JobStatus;
  readonly sticky?: boolean;
  readonly at?: number;
  readonly error?: ImageError;
  readonly remoteTaskId?: string;
}

const STATUS_RANK: Readonly<Record<JobStatus, number>> = {
  cancelled: 0,
  queued: 1,
  submitting: 2,
  running: 3,
  succeeded: 4,
  failed: 4,
};

/**
 * 把一次上游/内部状态上报应用到任务上，返回新对象。
 *
 * 规则：
 * - 同一状态重复上报是幂等的，`attempts` 不会重复累加；
 * - 迟到事件（时间戳早于最后更新）被忽略，防止乱序轮询把终态改回 running；
 * - 只有 `sticky` 的取消（或已经到过的取消）不会被 running 覆盖；
 * - 不会有状态之后再发出 "succeeded"，除非本地结果已持久化（由调用方保证）。
 */
export function applyTransition(job: ImageJob, transition: StatusTransition): ImageJob {
  const at = transition.at ?? Date.now();
  if (at < job.updatedAt && (transition.sticky !== true || transition.status === job.status)) {
    return job;
  }

  if (transition.status === job.status) {
    return {
      ...job,
      updatedAt: at,
      ...(transition.error ? { error: transition.error } : {}),
      ...(transition.remoteTaskId ? { remoteTaskId: transition.remoteTaskId } : {}),
    };
  }

  if (job.status === "cancelled" && !transition.sticky) {
    return job;
  }

  const occurred = classifyTransition(job.status, transition.status);
  if (occurred.kind === "ignored" || occurred.kind === "invalid") {
    return job;
  }

  const now = at;
  return {
    ...job,
    status: transition.status,
    attempts: transition.status === "submitting" ? Math.max(1, job.attempts) : job.attempts,
    updatedAt: now,
    ...(TIMESTAMPED.has(transition.status) && job.startedAt === undefined ? { startedAt: now } : {}),
    ...(TERMINAL_STATUSES.includes(transition.status) ? { finishedAt: now } : {}),
    ...(transition.error ? { error: transition.error } : {}),
    ...(transition.remoteTaskId ? { remoteTaskId: transition.remoteTaskId } : {}),
  };
}