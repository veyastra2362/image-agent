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
import type { AppEnvironment, WindowControls } from "@shared/app-shell";

/** 必须与 src/shared/channels.ts 的 IMAGE_CHANNELS 完全一致。 */
const CHANNELS = {
  bootstrap: "image:bootstrap",
  createJob: "image:create-job",
  cancelJob: "image:cancel-job",
  taskEvent: "image:task-event",
  notification: "image:notification",
} as const;

/** 必须与 src/main/window-ipc.ts 的 WINDOW_CHANNELS 完全一致（由测试校验）。 */
const WINDOW = {
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  close: "window:close",
  isMaximized: "window:is-maximized",
} as const;

/** 必须与 src/shared/app-shell.ts 的 APP_CHANNEL 完全一致（由测试校验）。 */
const APP_CHANNEL = "app:environment";
const EDIT_CHANNEL = "app:edit";

/** 必须与 src/main/library-ipc.ts 的 LIBRARY_CHANNELS 完全一致（由测试校验）。 */
const LIBRARY = {
  view: "library:view",
  chooseDir: "library:choose-dir",
  openDir: "library:open-dir",
} as const;

/** 必须与 src/main/settings-ipc.ts 的 SETTINGS_CHANNELS 完全一致（由测试校验）。 */
const SETTINGS = {
  view: "provider:settings-view",
  save: "provider:settings-save",
  remove: "provider:settings-remove",
  activate: "provider:settings-activate",
  create: "provider:settings-create",
  test: "provider:settings-test",
  fetchModels: "provider:fetch-models",
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

const windowControls: WindowControls = {
  minimize: () => ipcRenderer.invoke(WINDOW.minimize),
  toggleMaximize: () => ipcRenderer.invoke(WINDOW.toggleMaximize),
  close: () => ipcRenderer.invoke(WINDOW.close),
  isMaximized: () => ipcRenderer.invoke(WINDOW.isMaximized),
};

contextBridge.exposeInMainWorld("appWindow", Object.freeze(windowControls));

const environment = (): Promise<AppEnvironment> => ipcRenderer.invoke(APP_CHANNEL) as Promise<AppEnvironment>;
const edit = (action: string): Promise<boolean> => ipcRenderer.invoke(EDIT_CHANNEL, action) as Promise<boolean>;
contextBridge.exposeInMainWorld("appInfo", Object.freeze({ environment, edit }));

const settings = {
  view: () => ipcRenderer.invoke(SETTINGS.view),
  save: (payload: unknown) => ipcRenderer.invoke(SETTINGS.save, payload),
  remove: (id: string) => ipcRenderer.invoke(SETTINGS.remove, id),
  activate: (id: string) => ipcRenderer.invoke(SETTINGS.activate, id),
  create: () => ipcRenderer.invoke(SETTINGS.create),
  test: (payload?: unknown) => ipcRenderer.invoke(SETTINGS.test, payload),
  fetchModels: (payload?: unknown) => ipcRenderer.invoke(SETTINGS.fetchModels, payload),
};

contextBridge.exposeInMainWorld("appSettings", Object.freeze(settings));

const library = {
  view: () => ipcRenderer.invoke(LIBRARY.view),
  chooseDir: () => ipcRenderer.invoke(LIBRARY.chooseDir),
  openDir: () => ipcRenderer.invoke(LIBRARY.openDir),
};

contextBridge.exposeInMainWorld("appLibrary", Object.freeze(library));
