/**
 * Renderer 可调用的窄接口。
 *
 * preload 通过 contextBridge 暴露 `window.imageAgent`，其形状必须与此接口一致。
 * renderer 拿不到 ipcRenderer、ipcMain、channel 字符串，也拿不到任意 invoke。
 */
import type { ImageAgentApi as ImageAgentIpcApi } from "./image-generation.ts";

/** Renderer 拿到的 API；结果类型在通道两侧是同一个对象。 */
export type ImageAgentApi = ImageAgentIpcApi;

declare global {
  interface Window {
    readonly imageAgent: ImageAgentApi;
  }
}
