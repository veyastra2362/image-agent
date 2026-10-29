import type { ImageJob } from "../../shared/image-generation.ts";

export function formatTime(timestamp: number | undefined): string {
  if (timestamp === undefined) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
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

/**
 * 费用只显示上游给出的数字或用户自设的上限；没有价格就是"上游未提供"。
 *
 * 传入 count 时估算"这次提交 N 张"的费用，否则显示本次任务已知费用。
 */
export function formatCost(job: ImageJob, count?: number): string {
  if (job.billableImages === 0) return "不产生费用（本地假服务）";
  if (!job.estimatedCost || job.count === 0) return "上游未提供";
  const perImage = job.estimatedCost.amount / job.count;
  const amount = perImage * (count ?? job.count);
  return `${amount.toFixed(4)} ${job.estimatedCost.currency}`;
}

export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
