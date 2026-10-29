/**
 * 应用环境信息：版本号、平台、是否已配置真实服务。
 *
 * 这里只回传"有没有密钥"这种布尔与用户自己填的地址，绝不回传密钥本身或它的片段，
 * renderer 拿到的就是它需要的全部内容。
 */
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { BrowserWindow } from "electron";
import type { AppEnvironment } from "@shared/app-shell";
import { APP_CHANNEL } from "@shared/app-shell";

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

  return () => ipcMain.removeHandler(APP_CHANNEL);
}
