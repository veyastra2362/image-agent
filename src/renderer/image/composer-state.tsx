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

  readonly referenceOptions: readonly { readonly id: string; readonly label: string }[];
  /** 当前参考图：可多张，数量受能力位限制。 */
  readonly references: readonly ReferenceImage[];
  readonly setReferenceFromAsset: (id: string | undefined) => void;
  readonly uploadReference: (file: File) => Promise<void>;
  readonly clearReference: (id: string) => void;
  readonly referenceBusy: boolean;
  readonly referenceValid: boolean;
  readonly referenceLimit: number;


  readonly validation: ReturnType<typeof validateCreateJobInput>;
  readonly canSubmit: boolean;
  readonly pending: boolean;
  readonly submitError: string | undefined;
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
  const referenceLimit = Math.max(1, caps?.referenceImageLimit ?? 1);
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

  async function submit(): Promise<void> {
    if (!validation.ok || pending) return;
    setPending(true);
    setSubmitError(undefined);
    const result = await state.submit(validation.value);
    setPending(false);
    if (!result.ok) setSubmitError(result.message ?? "提交失败");
    else {
      setRequestId(newRequestId());
      onSubmitted();
    }
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
    referenceBusy,
    referenceValid,
    referenceLimit,
    validation,
    canSubmit,
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
  const options = new Map<string, { id: string; label: string }>();
  for (const entry of state.jobs) {
    for (const asset of entry.assets) {
      options.set(asset.id, {
        id: asset.id,
        label: `${asset.prompt.slice(0, 18)}… · ${asset.width}×${asset.height}`,
      });
    }
  }
  for (const asset of state.remembered) {
    if (!options.has(asset.id)) {
      options.set(asset.id, { id: asset.id, label: `${asset.prompt.slice(0, 18)}… · 历史记忆` });
    }
  }
  return [...options.values()];
}

export { LIMITS };
