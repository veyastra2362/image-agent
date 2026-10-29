/**
 * renderer 侧的尺寸/格式展示文案。纯函数，不碰 DOM 与 Node。
 */
import {
  PRESET_RATIOS,
  resolveCustomRatioSize,
  resolveRatioSize,
  type AspectRatio,
  type OutputFormat,
  type OutputSpec,
  type ResolutionTier,
} from "../../shared/image-generation.ts";

export const RATIO_LABELS: Record<Exclude<AspectRatio, "custom">, string> = {
  "1:1": "1:1 方形",
  "4:3": "4:3 横向",
  "3:4": "3:4 竖向",
  "16:9": "16:9 宽屏",
  "9:16": "9:16 竖屏",
  "3:2": "3:2 横向",
  "2:3": "2:3 竖向",
  "5:4": "5:4 稍宽",
  "4:5": "4:5 稍高",
  "21:9": "21:9 超宽",
  "9:21": "9:21 超长竖",
  "2:1": "2:1 双宽",
  "1:2": "1:2 双高",
};

export const TIER_LABELS: Record<ResolutionTier, string> = {
  1024: "1K 标准",
  1536: "1.5K 清晰",
  2048: "2K 高清",
  4096: "4K 超清",
};

export const FORMAT_LABELS: Record<OutputFormat, string> = {
  png: "PNG 无损",
  jpeg: "JPEG 体积小",
  webp: "WebP 更小",
};

export const FORMAT_MIME: Record<OutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function ratioOptions(): readonly Exclude<AspectRatio, "custom">[] {
  return PRESET_RATIOS;
}

/** 一句话描述当前选择会产出多大的图；auto 时说明由模型决定。 */
export function describeSpec(spec: OutputSpec, customRatioLabel: string): string {
  if (spec.mode === "auto") return "由模型自行决定尺寸";
  if (spec.mode === "custom") {
    if (!spec.width || !spec.height) return "请填写宽高";
    return `将使用 ${spec.width}×${spec.height}`;
  }
  if (spec.aspectRatio === "custom") {
    const size = resolveCustomRatioSize(customRatioLabel, spec.resolution);
    return size ? `将使用 ${size.width}×${size.height}` : "自定义比例不合法";
  }
  const size = resolveRatioSize(spec.aspectRatio, spec.resolution);
  return size ? `将使用 ${size.width}×${size.height}` : "比例不合法";
}

/** 自定义比例下"是否比短边更长"，只用于提示，不影响逻辑。 */
export function customRatioPreview(label: string, resolution: number): string {
  const size = resolveCustomRatioSize(label, resolution);
  return size ? `${size.width}×${size.height}` : "—";
}
