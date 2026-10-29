/**
 * 创作页的共享状态：左侧配置栏和右下方输入框各取所需。
 *
 * 拆成 context 是为了让"配置在左、提示词在右下"这个布局成立，
 * 而提交逻辑、校验、能力适配只留一份。
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LIMITS,
  validateCreateJobInput,
  type ImageCapabilities,
  type OutputSpec,
  type ProviderRef,
} from "../../shared/image-generation.ts";
import { newRequestId } from "../lib/format.ts";
import { describeSpec } from "../lib/output-spec.ts";
import type { ImageAgentState } from "./use-image-agent.ts";

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
  readonly referenceAssetId: string | undefined;
  readonly setReferenceAssetId: (id: string | undefined) => void;
  readonly referenceValid: boolean;

  readonly rewriteEnabled: boolean;
  readonly setRewriteEnabled: (enabled: boolean) => void;
  readonly rewritten: string;
  readonly setRewritten: (value: string) => void;
  readonly loadRewriteSource: () => void;

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
  const [prompt, setPrompt] = useState("一只在雨夜窗边打盹的橘猫，柔和侧光，电影感");
  const [rewriteEnabled, setRewriteEnabled] = useState(false);
  const [rewritten, setRewritten] = useState("");
  const [modelKey, setModelKey] = useState<string>();
  const [spec, setSpec] = useState<OutputSpec>(DEFAULT_SPEC);
  const [customRatio, setCustomRatio] = useState("16:10");
  const [sizeDialogOpen, setSizeDialogOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [referenceAssetId, setReferenceAssetId] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [pending, setPending] = useState(false);
  // 每次提交换一个 requestId：同一个 id 重提会被 main 当成重复请求（幂等保护）。
  const [requestId, setRequestId] = useState(newRequestId);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusPromptToken > 0) promptRef.current?.focus();
  }, [focusPromptToken]);

  // 只要配置了真实服务，就把离线假模型从选择器里去掉；全都没配时仍然保留，
  // 否则页面会没有任何可用模型。
  const visibleModels = useMemo(() => {
    const real = models.filter((candidate) => !candidate.id.includes("fake"));
    return real.length > 0 ? real : models;
  }, [models]);

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
  const referenceValid =
    referenceAssetId !== undefined &&
    referenceOptions.some((option) => option.id === referenceAssetId) &&
    (caps?.imageToImage ?? false);

  const validation = validateCreateJobInput({
    requestId,
    providerId: model?.id ?? "",
    ...(model === undefined ? {} : { model: model.model }),
    prompt,
    ...(rewriteEnabled && rewritten.trim() ? { agentPrompt: rewritten.trim() } : {}),
    ...(!referenceValid || referenceAssetId === undefined ? {} : { referenceAssetIds: [referenceAssetId] }),
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
    referenceAssetId,
    setReferenceAssetId,
    referenceValid,
    rewriteEnabled,
    setRewriteEnabled,
    rewritten,
    setRewritten,
    loadRewriteSource: () => {
      setRewriteEnabled(true);
      setRewritten((current) => (current.trim() ? current : prompt.trim()));
    },
    validation,
    canSubmit,
    pending,
    submitError,
    submit,
  };

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
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
