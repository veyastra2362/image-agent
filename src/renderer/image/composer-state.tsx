/**
 * 创作页的共享状态：左侧配置栏和右下方输入框各取所需。
 *
 * 拆成 context 是为了让"配置在左、提示词在右下"这个布局成立，
 * 而提交逻辑、校验、能力适配只留一份。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LIMITS,
  validateCreateJobInput,
  type ImageCapabilities,
  type OutputSpec,
  type ProviderRef,
} from "../../shared/image-generation.ts";
import { newRequestId } from "../lib/format.ts";
import { readFileAsDataUrl } from "../lib/format.ts";
import { describeSpec } from "../lib/output-spec.ts";
import type { ImageAgentState } from "./use-image-agent.ts";

/** 三种优化策略：不优化 / 写回输入框（两段式）/ 自动优化后直接出图。 */
export type OptimizeMode = "off" | "writeback" | "auto";

export interface ReferenceImage {
  readonly id: string;
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

const DEFAULT_SPEC: OutputSpec = {
  mode: "ratio",
  aspectRatio: "1:1",
  resolution: 1024,
  format: "png",
  compression: 0,
};

export interface ComposerValue {
  readonly state: ImageAgentState;
  readonly models: readonly ProviderRef[];
  /** 界面里可选的模型：有真实服务时不再出现离线假模型。 */
  readonly visibleModels: readonly ProviderRef[];
  readonly model: ProviderRef | undefined;
  readonly caps: ImageCapabilities | undefined;
  readonly modelKey: string | undefined;
  readonly setModelKey: (key: string) => void;

  readonly prompt: string;
  readonly setPrompt: (value: string) => void;
  readonly promptRef: React.RefObject<HTMLTextAreaElement | null>;

  readonly spec: OutputSpec;
  readonly effectiveSpec: OutputSpec;
  readonly customRatio: string;
  readonly setSpec: (spec: OutputSpec) => void;
  readonly setCustomRatio: (label: string) => void;
  readonly sizeSummary: string;
  readonly sizeDialogOpen: boolean;
  readonly setSizeDialogOpen: (open: boolean) => void;

  readonly count: number;
  readonly setCount: (value: number) => void;
  readonly effectiveCount: number;
  readonly maxCount: number;

  readonly seed: string;
  readonly setSeed: (value: string) => void;
  readonly negativePrompt: string;
  readonly setNegativePrompt: (value: string) => void;

  readonly referenceOptions: readonly {
    readonly id: string;
    readonly label: string;
    readonly meta: string;
    readonly previewUrl: string;
  }[];
  /** 当前参考图：可多张，数量受能力位限制。 */
  readonly references: readonly ReferenceImage[];
  readonly setReferenceFromAsset: (id: string | undefined) => void;
  readonly uploadReference: (file: File) => Promise<void>;
  readonly clearReference: (id: string) => void;
  readonly clearAllReferences: () => void;
  readonly referenceBusy: boolean;
  readonly referenceValid: boolean;
  readonly referenceLimit: number;
  /** 生成前先用 Agent 改写提示词。 */
  /** 优化方式：写回输入框 / 自动优化后直接生成 / 先规划再确认。 */
  readonly optimizeMode: OptimizeMode;
  readonly setOptimizeMode: (mode: OptimizeMode) => void;
  /** 星形按钮：按当前选择执行写回 / 直接生成 / 先规划。 */
  readonly optimizing: boolean;
  /** Agent 规划结果：有值时界面弹确认框，用户确认后才真正提交。 */
  /** 直接优化提示词（不经过计划弹窗）；成功后替换输入框内容。 */
  readonly optimizeNow: () => Promise<boolean>;
  /** 优化后直接出图（不弹计划窗）。 */
  readonly optimizeAndSubmit: () => Promise<void>;
  readonly optimizeBusy: boolean;
  /** 是否配置了语言模型（决定开关能不能用）。 */
  readonly agentAvailable: boolean;


  readonly validation: ReturnType<typeof validateCreateJobInput>;
  readonly canSubmit: boolean;
  readonly pending: boolean;
  readonly submitError: string | undefined;
  /** 写回模式下"下一次点击是改写还是出图"：改写过就是出图。 */
  readonly nextClickOptimizes: boolean;
  readonly submit: () => Promise<void>;
}

const ComposerContext = createContext<ComposerValue | undefined>(undefined);

export function useComposer(): ComposerValue {
  const value = useContext(ComposerContext);
  if (value === undefined) throw new Error("useComposer 必须在 ComposerProvider 内使用");
  return value;
}

export interface ComposerProviderProps {
  readonly state: ImageAgentState;
  readonly models: readonly ProviderRef[];
  readonly onSubmitted: () => void;
  /** 每次加一都会把焦点送回提示词输入框。 */
  readonly focusPromptToken: number;
  readonly children: ReactNode;
}

export function ComposerProvider({ state, models, onSubmitted, focusPromptToken, children }: ComposerProviderProps) {
  const [prompt, setPrompt] = useState("");
  const [modelKey, setModelKey] = useState<string>();
  const [spec, setSpec] = useState<OutputSpec>(DEFAULT_SPEC);
  const [customRatio, setCustomRatio] = useState("16:10");
  const [sizeDialogOpen, setSizeDialogOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [references, setReferences] = useState<readonly ReferenceImage[]>([]);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [optimizeMode, setOptimizeMode] = useState<OptimizeMode>("writeback");
  /** 已经优化过、等着被发送的提示词；用来区分"第一次点=优化"和"第二次点=出图" */
  const [pendingOptimized, setPendingOptimized] = useState<string>();
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeBusy, setOptimizeBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [pending, setPending] = useState(false);
  // 每次提交换一个 requestId：同一个 id 重提会被 main 当成重复请求（幂等保护）。
  const [requestId, setRequestId] = useState(newRequestId);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusPromptToken > 0) promptRef.current?.focus();
  }, [focusPromptToken]);

  // 没有配置服务商就是没有模型：界面留空，不再回落到任何内置假模型。
  const visibleModels = models;

  const model = useMemo(() => resolveModel(visibleModels, modelKey), [visibleModels, modelKey]);
  const caps = model?.capabilities;
  const supportedRatios = caps?.aspectRatios ?? [];

  // 当前模型不支持的模式/比例/格式要退回它能接受的值：界面永远显示"真正会发出去的那份设置"。
  const effectiveSpec: OutputSpec = useMemo(() => {
    const mode =
      spec.mode === "auto" && !caps?.autoSize ? "ratio" : spec.mode === "custom" && !caps?.customSize ? "ratio" : spec.mode;
    const aspectRatio =
      mode === "ratio" && !supportedRatios.includes(spec.aspectRatio) ? (supportedRatios[0] ?? "1:1") : spec.aspectRatio;
    const format = spec.format !== "png" && !caps?.transcode ? "png" : spec.format;
    return { ...spec, mode, aspectRatio, format };
  }, [spec, caps, supportedRatios]);

  const maxCount = caps?.outputCountLimit ?? 1;
  const effectiveCount = Math.min(Math.max(1, count), maxCount);

  const referenceOptions = useMemo(() => referenceSources(state), [state]);
  // Infinity = 不限张数；没声明能力时按 0 处理（不能加参考图）。
  const referenceLimit = caps?.referenceImageLimit ?? 0;
  const referenceValid = references.length > 0 && (caps?.imageToImage ?? false);

  /** 从作品库加一张：预览地址用作品自身的 URL。 */
  const setReferenceFromAsset = useCallback(
    (id: string | undefined) => {
      if (id === undefined) {
        setReferences([]);
        return;
      }
      const found =
        state.jobs.flatMap((entry) => entry.assets).find((candidate) => candidate.id === id) ??
        state.remembered.find((candidate) => candidate.id === id);
      if (found === undefined) return;
      setReferences((current) =>
        current.some((item) => item.id === id) || current.length >= referenceLimit
          ? current
          : [...current, { id, src: found.previewUrl, width: found.width, height: found.height }],
      );
    },
    [state, referenceLimit],
  );

  /** 上传一张本地图片：转 base64 交给 main 落库，预览用本地 data URL。 */
  const uploadReference = useCallback(
    async (file: File) => {
      if (file.size > 10 * 1024 * 1024) {
        setSubmitError("参考图不能超过 10MB");
        return;
      }
      setReferenceBusy(true);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const dataBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const result = await window.imageAgent.uploadReference({
          dataBase64,
          mimeType: file.type || "image/png",
        });
        if (!result.ok) {
          setSubmitError(result.error.message);
          return;
        }
        setReferences((current) =>
          current.length >= referenceLimit
            ? current
            : [...current, { id: result.assetId, src: dataUrl, width: result.width, height: result.height }],
        );
        setSubmitError(undefined);
      } catch (error) {
        setSubmitError(`读取图片失败：${safeMessage(error)}`);
      } finally {
        setReferenceBusy(false);
      }
    },
    [referenceLimit],
  );

  const clearReference = useCallback((id: string) => {
    setReferences((current) => current.filter((item) => item.id !== id));
  }, []);
  const clearAllReferences = useCallback(() => setReferences([]), []);

  const validation = validateCreateJobInput({
    requestId,
    providerId: model?.id ?? "",
    ...(model === undefined ? {} : { model: model.model }),
    prompt,
    ...(!referenceValid ? {} : { referenceAssetIds: references.map((item) => item.id) }),
    aspectRatio: effectiveSpec.aspectRatio,
    sizeMode: effectiveSpec.mode,
    ...(effectiveSpec.mode === "custom"
      ? { width: effectiveSpec.width ?? 1024, height: effectiveSpec.height ?? 1024 }
      : {}),
    format: effectiveSpec.format,
    compression: effectiveSpec.compression,
    count: effectiveCount,
    ...(caps?.seed && seed.trim() !== "" ? { seed: Number(seed) } : {}),
    ...(caps?.negativePrompt && negativePrompt.trim() !== "" ? { negativePrompt } : {}),
  });

  const canSubmit = validation.ok && model !== undefined && !pending && state.status === "ready";
  // 写回模式下还差一次改写：用来切换生成按钮上的图标。
  const nextClickOptimizes =
    state.agentAvailable &&
    optimizeMode === "writeback" &&
    prompt.trim() !== "" &&
    pendingOptimized !== prompt.trim();

  /** 真正提交：确认计划之后也走这里，避免两套参数拼装逻辑。 */
  async function submitWith(payloadOverride: Record<string, unknown> = {}): Promise<void> {
    if (!validation.ok || pending) return;
    const payload = { ...validation.value, ...payloadOverride };
    setPending(true);
    setSubmitError(undefined);
    const result = await state.submit(payload);
    setPending(false);
    if (!result.ok) setSubmitError(result.message ?? "提交失败");
    else setRequestId(newRequestId());
  }

  /** 生成按钮旁边的一键优化：拿到改写结果直接替换输入框，并留一次撤销。 */
  async function optimizeNow(): Promise<boolean> {
    const text = prompt.trim();
    if (text === "") {
      setSubmitError("请先写好提示词");
      return false;
    }
    setOptimizeBusy(true);
    const result = await window.imageAgent.optimizePrompt({ prompt: text });
    setOptimizeBusy(false);
    if (result.ok) {
      setPrompt(result.prompt);
      setPendingOptimized(result.prompt.trim());
      setSubmitError(undefined);
      return true;
    }
    setSubmitError(`优化失败：${result.error.message}`);
    return false;
  }

  /** 优化并直接生成：改写结果同时写回输入框，用户能看到实际用的是什么。 */
  async function optimizeAndSubmit(): Promise<void> {
    const text = prompt.trim();
    if (text === "" || pending) return;
    setOptimizeBusy(true);
    const result = await window.imageAgent.optimizePrompt({ prompt: text });
    setOptimizeBusy(false);
    if (!result.ok) {
      setSubmitError(`优化失败：${result.error.message}`);
      return;
    }
    setPrompt(result.prompt);
    setSubmitError(undefined);
    await submitWith({ prompt: text, agentPrompt: result.prompt });
  }

  /** 生成按钮：策略决定它是"优化"还是"出图"。 */
  async function submit(): Promise<void> {
    if (!validation.ok || pending) return;
    const text = prompt.trim();
    if (state.agentAvailable && optimizeMode === "auto") {
      await optimizeAndSubmit();
      return;
    }
    if (state.agentAvailable && optimizeMode === "writeback") {
      // 第一次点：改写并写回输入框；第二次点（提示词没再改过）：直接出图。
      if (pendingOptimized !== text) {
        const optimized = await optimizeNow();
        // 改写失败（语言模型没配好之类）不要卡住用户：继续按原文出图。
        if (optimized) return;
      }
      setPendingOptimized(undefined);
    }
    await submitWith();
  }

  /** 星形按钮：写回输入框 / 直接出图 / 先规划，跟当前选择一致。 */
  async function runOptimizeAction(): Promise<void> {
    if (optimizeMode === "auto") {
      await optimizeAndSubmit();
      return;
    }

    await optimizeNow();
  }

  const value: ComposerValue = {
    state,
    models,
    visibleModels,
    model,
    caps,
    modelKey,
    setModelKey,
    prompt,
    setPrompt,
    promptRef,
    spec,
    effectiveSpec,
    customRatio,
    setSpec,
    setCustomRatio,
    sizeSummary: describeSpec(effectiveSpec, customRatio),
    sizeDialogOpen,
    setSizeDialogOpen,
    count,
    setCount,
    effectiveCount,
    maxCount,
    seed,
    setSeed,
    negativePrompt,
    setNegativePrompt,
    referenceOptions,
    references,
    setReferenceFromAsset,
    uploadReference,
    clearReference,
    clearAllReferences,
    referenceBusy,
    referenceValid,
    referenceLimit,
    optimizeMode,
    setOptimizeMode,
    optimizing,
    agentAvailable: state.agentAvailable,
    optimizeNow,
    optimizeAndSubmit,
    optimizeBusy,
    validation,
    canSubmit,
    nextClickOptimizes,
    pending,
    submitError,
    submit,
  };

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
}

export function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveModel(models: readonly ProviderRef[], key: string | undefined): ProviderRef | undefined {
  if (key) {
    const found = models.find((candidate) => `${candidate.id}:${candidate.model}` === key);
    if (found) return found;
  }
  // 默认选中"id 里没有 fake"的第一个模型：配好真实服务时优先真实模型，
  // 否则退回 provider 声明的默认项。列表为空时返回 undefined。
  const preferred = models.find((candidate) => !candidate.id.includes("fake"));
  return preferred ?? models.find((candidate) => candidate.default) ?? models[0];
}

export function referenceSources(state: ImageAgentState) {
  const options = new Map<string, { id: string; label: string; meta: string; previewUrl: string }>();
  for (const entry of state.jobs) {
    for (const asset of entry.assets) {
      options.set(asset.id, {
        id: asset.id,
        label: asset.prompt,
        meta: `${asset.width}×${asset.height}`,
        previewUrl: asset.previewUrl,
      });
    }
  }
  for (const asset of state.remembered) {
    if (!options.has(asset.id)) {
      options.set(asset.id, {
        id: asset.id,
        label: asset.prompt,
        meta: "历史记忆",
        previewUrl: asset.previewUrl,
      });
    }
  }
  return [...options.values()];
}

export { LIMITS };