/** 任务状态在界面上的文字、语气和是否可操作。状态文案与图形同时出现，不只靠颜色。 */
import type { JobStatus } from "../../shared/image-generation.ts";

export type Tone = "neutral" | "active" | "success" | "danger" | "muted";

export interface StatusPresentation {
  readonly label: string;
  readonly tone: Tone;
  readonly glyph: string;
  readonly active: boolean;
  readonly cancellable: boolean;
}

const PRESENTATION: Readonly<Record<JobStatus, StatusPresentation>> = {
  queued: { label: "排队中", tone: "muted", glyph: "○", active: true, cancellable: true },
  submitting: { label: "正在提交", tone: "active", glyph: "◔", active: true, cancellable: true },
  running: { label: "生成中", tone: "active", glyph: "◑", active: true, cancellable: true },
  succeeded: { label: "已完成", tone: "success", glyph: "●", active: false, cancellable: false },
  failed: { label: "失败", tone: "danger", glyph: "✕", active: false, cancellable: false },
  cancelled: { label: "已取消", tone: "muted", glyph: "—", active: false, cancellable: false },
};

export function describeStatus(status: JobStatus): StatusPresentation {
  return PRESENTATION[status];
}
