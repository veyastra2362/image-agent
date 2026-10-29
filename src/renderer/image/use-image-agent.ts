/**
 * renderer 侧的 image 状态：只通过 window.imageAgent（窄 preload API）与 main 通信。
 *
 * 所有校验都只是"提前给用户一个提示"；真正的边界在 main。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ImageBootstrap,
  ImageRequestResult,
  ImageTaskEvent,
  Notification,
  ProviderRef,
} from "../../shared/image-generation.ts";
import { describeStatus } from "../lib/job-status.ts";
import {
  loadRememberedAssets,
  mergeRememberedAssets,
  saveRememberedAssets,
  type RememberedAsset,
} from "./memory-library.ts";

export interface ToastItem extends Notification {
  readonly id: number;
}

export interface ImageAgentState {
  readonly status: "loading" | "ready" | "unavailable" | "error";
  readonly loadError?: string;
  readonly models: readonly ProviderRef[];
  readonly jobs: readonly ImageTaskEvent[];
  readonly toasts: readonly ToastItem[];
  readonly remembered: readonly RememberedAsset[];
  readonly submit: (input: unknown) => Promise<{ ok: boolean; message?: string }>;
  readonly cancel: (jobId: string) => Promise<void>;
  readonly dismissToast: (id: number) => void;
  readonly openAsset: (assetId: string) => void;
  readonly closeDrawer: () => void;
  /** 最近一次成功任务的第一张图；用于"查看最新结果"。 */
  readonly latestAssetId?: string;
  readonly selectedAssetId?: string;
  readonly selectedPreview?: string;
}

function upsertJob(jobs: readonly ImageTaskEvent[], next: ImageTaskEvent): ImageTaskEvent[] {
  const index = jobs.findIndex((entry) => entry.job.id === next.job.id);
  if (index === -1) return [next, ...jobs];
  const copy = jobs.slice();
  copy[index] = next;
  return copy;
}

/** 终态事件按 updatedAt 排序，避免迟到的旧事件覆盖新状态。 */
function isStale(previous: ImageTaskEvent | undefined, next: ImageTaskEvent): boolean {
  return previous !== undefined && next.job.updatedAt < previous.job.updatedAt && previous.job.status !== next.job.status;
}

export function useImageAgent(): ImageAgentState {
  const [status, setStatus] = useState<ImageAgentState["status"]>("loading");
  const [loadError, setLoadError] = useState<string>();
  const [models, setModels] = useState<readonly ProviderRef[]>([]);
  const [jobs, setJobs] = useState<readonly ImageTaskEvent[]>([]);
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const [remembered, setRemembered] = useState<readonly RememberedAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const jobsRef = useRef<readonly ImageTaskEvent[]>([]);
  const toastId = useRef(1);

  const pushToast = useCallback((notification: Notification) => {
    const item: ToastItem = { ...notification, id: toastId.current++ };
    setToasts((current) => [...current.slice(-3), item]);
  }, []);

  const receive = useCallback(
    (event: ImageTaskEvent) => {
      setJobs((current) => {
        const previous = current.find((entry) => entry.job.id === event.job.id);
        const next = isStale(previous, event) ? current : upsertJob(current, event);
        jobsRef.current = next;
        return next;
      });
      if (event.assets.length > 0) {
        setRemembered((current) => {
          const merged = mergeRememberedAssets(current, event);
          saveRememberedAssets(merged);
          return merged;
        });
      }
    },
    [],
  );

  useEffect(() => {
    const api = window.imageAgent;
    if (!api) {
      setStatus("unavailable");
      return;
    }
    let disposed = false;
    const unsubscribeTask = api.onTaskEvent((event) => {
      if (!disposed) receive(event);
    });
    const unsubscribeNotify = api.onNotification((notification) => {
      if (!disposed) pushToast(notification);
    });

    api
      .getBootstrap()
      .then((bootstrap: ImageBootstrap) => {
        if (disposed) return;
        setModels(bootstrap.providers);
        setJobs(bootstrap.jobs);
        jobsRef.current = bootstrap.jobs;
        const known = new Set(bootstrap.jobs.flatMap((entry) => entry.assets.map((asset) => asset.id)));
        setRemembered(loadRememberedAssets(known));
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setStatus("error");
      });

    return () => {
      disposed = true;
      unsubscribeTask();
      unsubscribeNotify();
    };
  }, [pushToast, receive]);

  const submit = useCallback(
    async (input: unknown) => {
      const parsed: unknown = await window.imageAgent.createJob(input).catch(() => undefined);
      const result = parsed as ImageRequestResult | undefined;
      if (!result) return { ok: false, message: "提交失败：主进程没有响应" };
      if (!result.ok) return { ok: false, message: result.error.message };
      receive(result.event);
      return { ok: true };
    },
    [receive],
  );

  const cancel = useCallback(
    async (jobId: string) => {
      const parsed: unknown = await window.imageAgent.cancelJob(jobId).catch(() => undefined);
      const result = parsed as ImageRequestResult | undefined;
      if (!result) pushToast({ level: "error", message: "取消失败：主进程没有响应" });
      else if (!result.ok) pushToast({ level: "error", message: `无法取消：${result.error.message}` });
    },
    [pushToast],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  // 提示 6 秒后自动淡出；键盘用户也可以手动关闭。
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => setToasts((current) => current.slice(1)), 6000);
    return () => clearTimeout(timer);
  }, [toasts]);

  const selected = useMemo(
    () => jobs.flatMap((entry) => entry.assets).find((asset) => asset.id === selectedAssetId),
    [jobs, selectedAssetId],
  );
  const selectedPreview =
    selected?.previewUrl ?? remembered.find((asset) => asset.id === selectedAssetId)?.previewUrl;

  const openAsset = useCallback((assetId: string) => setSelectedAssetId(assetId), []);
  const closeDrawer = useCallback(() => setSelectedAssetId(undefined), []);
  const latestAssetId = useMemo(() => latestSucceededJob(jobs)?.assets[0]?.id, [jobs]);

  return {
    status,
    ...(loadError === undefined ? {} : { loadError }),
    models,
    jobs,
    toasts,
    remembered,
    submit,
    cancel,
    dismissToast,
    openAsset,
    closeDrawer,
    ...(latestAssetId === undefined ? {} : { latestAssetId }),
    ...(selectedAssetId === undefined ? {} : { selectedAssetId }),
    ...(selectedPreview === undefined ? {} : { selectedPreview }),
  };
}

/**
 * 只有"上游真的支持取消"且任务仍在进行时才提供停止按钮。
 * 同步 provider 进行中时取消会丢弃结果并可能已经产生费用，因此显示真实状态，不假装能停止。
 */
export function cancellable(event: ImageTaskEvent): boolean {
  const presentation = describeStatus(event.job.status);
  return presentation.cancellable && event.job.capabilities.cancel;
}

export function latestSucceededJob(jobs: readonly ImageTaskEvent[]): ImageTaskEvent | undefined {
  return jobs.find((entry) => entry.job.status === "succeeded" && entry.assets.length > 0);
}

function latestSuccessfulAsset(event: ImageTaskEvent | undefined): string | undefined {
  return event?.assets[0]?.id;
}