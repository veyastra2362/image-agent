/**
 * 产物转码：把上游返回的 PNG 转成用户选的 jpeg / webp，并应用压缩率。
 *
 * 只在这里碰 sharp：它是原生模块，只能跑在 main。转换失败不静默降级成 PNG，
 * 而是明确报错——用户选了 webp 却拿到 png，在导入其他工具时会出问题。
 */
import sharp from "sharp";
import type { OutputFormat } from "@shared/image-generation";

export interface TranscodeRequest {
  readonly bytes: Buffer;
  readonly format: OutputFormat;
  /** 0 = 画质优先，100 = 体积优先。png 忽略此项。 */
  readonly compression: number;
}

const MIME_BY_FORMAT: Readonly<Record<OutputFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function mimeForFormat(format: OutputFormat): string {
  return MIME_BY_FORMAT[format];
}

/** 压缩率 → 编码质量。0 → 100 质量，100 → 40 质量（再低就明显糊了）。 */
export function qualityForCompression(compression: number): number {
  const clamped = Math.min(100, Math.max(0, Math.round(compression)));
  return Math.round(100 - clamped * 0.6);
}

export interface TranscodeResult {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

export async function transcodeImage(request: TranscodeRequest): Promise<TranscodeResult> {
  const { bytes, format } = request;
  if (format === "png") {
    // 已经是 PNG，原样保留，不重新编码（避免无谓的像素改动）。
    const meta = await sharp(bytes).metadata();
    return { bytes, mimeType: MIME_BY_FORMAT.png, width: meta.width ?? 0, height: meta.height ?? 0 };
  }

  const quality = qualityForCompression(request.compression);
  const pipeline = sharp(bytes);
  const encoded = await (format === "jpeg" ? pipeline.jpeg({ quality, mozjpeg: true }) : pipeline.webp({ quality })).toBuffer();
  const meta = await sharp(encoded).metadata();
  return {
    bytes: encoded,
    mimeType: MIME_BY_FORMAT[format],
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}
