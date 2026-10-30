import type { ImageJob } from "../../shared/image-generation.ts";

/**
 * 绝对时间：带年月日。
 *
 * 作品库按天翻的时候，只有"10:52"根本分不清是哪天；默认给到分钟，
 * 需要精确到秒的地方显式传 withSeconds。
 */
export function formatTime(timestamp: number | undefined, options: { readonly withSeconds?: boolean } = {}): string {
  if (timestamp === undefined) return "—";
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return options.withSeconds === true ? `${day} ${clock}:${pad(date.getSeconds())}` : `${day} ${clock}`;
}

export function formatDuration(job: ImageJob): string {
  const end = job.finishedAt ?? job.updatedAt;
  const start = job.startedAt ?? job.createdAt;
  if (end <= start) return "—";
  const seconds = (end - start) / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} 秒` : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}


export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 读成本地 data URL（参考图预览与上传都用它）。 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取失败"));
    reader.readAsDataURL(file);
  });
}
