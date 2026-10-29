/**
 * 详情抽屉：模型、原始提示词、Agent 改写、实际发送的提示词、参数、时间、
 * 尺寸/格式与错误原文。所有内容来自 main 记录的任务快照，不在这里推断。
 */
import { useEffect, useRef } from "react";
import { CloseIcon } from "../shell/icons.tsx";
import type { ImageAsset, ImageJob } from "../../shared/image-generation.ts";
import { formatBytes, formatDuration, formatTime } from "../lib/format.ts";
import { describeStatus } from "../lib/job-status.ts";
import type { ImageAgentState } from "./use-image-agent.ts";

interface DetailsDrawerProps {
  readonly state: ImageAgentState;
  readonly onClose: () => void;
}

export function DetailsDrawer({ state, onClose }: DetailsDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const asset = state.jobs.flatMap((entry) => entry.assets).find((candidate) => candidate.id === state.selectedAssetId);
  const job = asset ? state.jobs.find((entry) => entry.job.id === asset.jobId)?.job : undefined;
  const memory = asset
    ? undefined
    : state.remembered.find((candidate) => candidate.id === state.selectedAssetId);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="作品详情">
        <header className="drawer__head">
          <h2>详情</h2>
          <button
            ref={closeRef}
            type="button"
            className="button button--icon"
            onClick={onClose}
            aria-label="关闭详情"
            title="关闭（Esc）"
          >
            <CloseIcon size={12} />
          </button>
        </header>
        {state.selectedPreview && (
          <img className="drawer__image" src={state.selectedPreview} alt={asset?.prompt ?? memory?.prompt ?? "作品"} />
        )}
        {asset && job ? (
          <AssetDetails asset={asset} job={job} siblings={state.jobs.find((e) => e.job.id === job.id)?.assets ?? []} />
        ) : memory ? (
          <dl className="facts">
            <Fact label="提示词" value={memory.prompt} multiline />
            <Fact label="尺寸" value={`${memory.width}×${memory.height}`} />
            <Fact label="来源" value="上次会话的页面记忆（任务记录已随应用重启清空）" />
          </dl>
        ) : (
          <p className="drawer__missing">这张作品的记录已不在当前会话中。</p>
        )}
      </aside>
    </div>
  );
}

function AssetDetails({
  asset,
  job,
  siblings,
}: {
  readonly asset: ImageAsset;
  readonly job: ImageJob;
  readonly siblings: readonly ImageAsset[];
}) {
  const presentation = describeStatus(job.status);
  return (
    <dl className="facts">
      <Fact label="状态" value={`${presentation.glyph} ${presentation.label}`} />
      <Fact label="服务 / 模型" value={`${job.providerDisplayName} / ${job.modelDisplayName}（${job.model}）`} />
      <Fact label="原始提示词" value={job.prompt} multiline />
      {job.agentPrompt !== undefined && <Fact label="Agent 改写（已确认）" value={job.agentPrompt} multiline />}
      <Fact label="实际发送" value={job.submittedPrompt} multiline />
      <Fact label="画面比例" value={job.aspectRatio} />
      <Fact label="本次请求张数" value={String(job.count)} />
      {job.seed !== undefined && <Fact label="Seed" value={String(job.seed)} />}
      {job.negativePrompt !== undefined && <Fact label="负面提示词" value={job.negativePrompt} />}
      <Fact
        label="参考图"
        value={job.referenceAssetIds.length === 0 ? "无" : job.referenceAssetIds.join("、")}
        {...(job.uploadsUserAssets ? { warn: "参考图已上传给该服务商" } : {})}
      />
      <Fact label="耗时" value={formatDuration(job)} />
      <Fact label="创建 / 完成" value={`${formatTime(job.createdAt)} / ${formatTime(job.finishedAt)}`} />
      <Fact label="文件" value={`PNG · ${asset.width}×${asset.height} · ${formatBytes(asset.byteLength)}`} />
      <Fact label="任务 ID" value={job.id} mono />
      {job.remoteTaskId && <Fact label="上游任务 ID" value={job.remoteTaskId} mono />}
      {siblings.length > 1 && <Fact label="同批图片" value={`共 ${siblings.length} 张`} />}
      {job.error && <Fact label="错误" value={job.error.message} multiline warntone />}
    </dl>
  );
}

function Fact({
  label,
  value,
  multiline,
  mono,
  warn,
  warntone,
}: {
  readonly label: string;
  readonly value: string;
  readonly multiline?: boolean;
  readonly mono?: boolean;
  readonly warn?: string;
  readonly warntone?: boolean;
}) {
  const className = [multiline ? "fact--multiline" : "", mono ? "fact--mono" : "", warntone ? "fact--error" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={`fact ${className}`}>
      <dt>{label}</dt>
      <dd>
        {value}
        {warn && <span className="fact__warn">{warn}</span>}
      </dd>
    </div>
  );
}
