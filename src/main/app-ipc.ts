/**
 * 应用环境信息：版本号、平台、是否已配置真实服务。
 *
 * 这里只回传"有没有密钥"这种布尔与用户自己填的地址，绝不回传密钥本身或它的片段，
 * renderer 拿到的就是它需要的全部内容。
 */
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { BrowserWindow } from "electron";
import type { AppEnvironment } from "@shared/app-shell";
import { APP_CHANNEL, EDIT_CHANNEL, isEditAction } from "@shared/app-shell";

export interface EnvironmentSource {
  readonly providerConfigured: boolean;
  readonly providerBaseUrl?: string;
  readonly models: readonly string[];
}

export function registerAppIpc(
  getWindow: () => BrowserWindow | undefined,
  source: () => EnvironmentSource,
): () => void {
  const trusted = (event: IpcMainInvokeEvent): boolean => {
    const window = getWindow();
    return window !== undefined && !window.isDestroyed() && event.sender === window.webContents;
  };

  ipcMain.handle(APP_CHANNEL, (event): AppEnvironment => {
    if (!trusted(event)) throw new Error("unauthorized");
    const environment = source();
    return {
      appName: app.getName(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? "unknown",
      chromeVersion: process.versions.chrome ?? "unknown",
      nodeVersion: process.versions.node ?? "unknown",
      platform: `${process.platform}-${process.arch}`,
      providerConfigured: environment.providerConfigured,
      ...(environment.providerBaseUrl === undefined ? {} : { providerBaseUrl: environment.providerBaseUrl }),
      models: environment.models,
    };
  });

  // 编辑菜单：必须走 webContents，才能作用在渲染进程当前聚焦的输入框上。
  ipcMain.handle(EDIT_CHANNEL, (event, raw: unknown): boolean => {
    if (!trusted(event)) return false;
    if (!isEditAction(raw)) return false;
    const contents = event.sender;
    switch (raw) {
      case "undo":
        contents.undo();
        return true;
      case "redo":
        contents.redo();
        return true;
      case "cut":
        contents.cut();
        return true;
      case "copy":
        contents.copy();
        return true;
      case "paste":
        contents.paste();
        return true;
      case "delete":
        contents.delete();
        return true;
      case "selectAll":
        contents.selectAll();
        return true;
    }
  });

  return () => {
    ipcMain.removeHandler(APP_CHANNEL);
    ipcMain.removeHandler(EDIT_CHANNEL);
  };
}
