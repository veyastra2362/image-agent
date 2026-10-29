/**
 * Preload：只暴露 window.imageAgent 的明确方法。
 *
 * 不暴露 ipcRenderer、channel 字符串或通用 invoke。事件订阅返回可取消的函数，
 * 回调在 renderer 中收到的始终是纯数据（无 Node 对象、无返回通道）。
 *
 * 约束：开启 sandbox 后 preload 是自包含脚本，除 electron 内置模块外任何 require 都会失败
 * （同目录文件也不行，已在 Electron 45 实测）。所以这里不能引用项目内模块，channel 名字
 * 内联一份；它与 src/shared/channels.ts 是否一致由 src/test/image-preload.test.ts 校验。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ImageAgentApi, ImageTaskEvent, Notification, Unsubscribe } from "@shared/image-generation";

/** 必须与 src/shared/channels.ts 的 IMAGE_CHANNELS 完全一致。 */
const CHANNELS = {
  bootstrap: "image:bootstrap",
  createJob: "image:create-job",
  cancelJob: "image:cancel-job",
  taskEvent: "image:task-event",
  notification: "image:notification",
} as const;

function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, payload: T) => {
    listener(payload);
  };
  ipcRenderer.on(channel, handler);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: ImageAgentApi = {
  getBootstrap: () => ipcRenderer.invoke(CHANNELS.bootstrap),
  createJob: (input: unknown) => ipcRenderer.invoke(CHANNELS.createJob, input),
  cancelJob: (jobId: string) => ipcRenderer.invoke(CHANNELS.cancelJob, jobId),
  onTaskEvent: (listener: (event: ImageTaskEvent) => void) => subscribe<ImageTaskEvent>(CHANNELS.taskEvent, listener),
  onNotification: (listener: (notification: Notification) => void) =>
    subscribe<Notification>(CHANNELS.notification, listener),
};

contextBridge.exposeInMainWorld("imageAgent", Object.freeze(api));
