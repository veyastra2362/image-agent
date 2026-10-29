/**
 * 窗口控制 IPC：自绘标题栏需要的"最小化 / 最大化 / 关闭"。
 *
 * 只接受本窗口顶层 frame 的调用，且只作用在 getWindow() 返回的窗口上，
 * 不接受调用方指定的窗口或任意参数——renderer 无法拿它去操作别的窗口。
 */
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { BrowserWindow } from "electron";

export const WINDOW_CHANNELS = {
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  close: "window:close",
  isMaximized: "window:is-maximized",
} as const;

export const WINDOW_CHANNEL_LIST: readonly string[] = Object.values(WINDOW_CHANNELS);

export function registerWindowIpc(getWindow: () => BrowserWindow | undefined): () => void {
  const trusted = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents) {
      throw new Error("unauthorized");
    }
    return window;
  };

  ipcMain.handle(WINDOW_CHANNELS.minimize, (event) => {
    trusted(event).minimize();
  });
  ipcMain.handle(WINDOW_CHANNELS.toggleMaximize, (event) => {
    const window = trusted(event);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle(WINDOW_CHANNELS.close, (event) => {
    trusted(event).close();
  });
  ipcMain.handle(WINDOW_CHANNELS.isMaximized, (event) => trusted(event).isMaximized());

  return () => {
    for (const channel of WINDOW_CHANNEL_LIST) ipcMain.removeHandler(channel);
  };
}
