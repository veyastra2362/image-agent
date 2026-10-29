/**
 * 数据管理的 IPC：导出 / 导入 / 清除，以及一个给界面用的摘要。
 *
 * 文件路径只能来自系统对话框，renderer 传过来的字符串不可信；
 * 复选框（要不要配置、要不要任务与图片）由 renderer 传，main 只接受布尔值。
 */
import { ipcMain, dialog, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { existsSync } from "node:fs";

import { isDataSelection, type DataResult, type DataSelection, type DataSummary } from "@shared/data-management";
import { defaultExportName, type DataManager } from "./data-manager";

export const DATA_CHANNELS = {
  summary: "data:summary",
  export: "data:export",
  import: "data:import",
  clear: "data:clear",
} as const;

export const DATA_CHANNEL_LIST: readonly string[] = Object.values(DATA_CHANNELS);

export interface DataIpcDeps {
  readonly getWindow: () => BrowserWindow | undefined;
  readonly manager: DataManager;
  /** 导入/清除后让 renderer 重新拉一次任务列表。 */
  readonly onChanged: () => void;
}

type SimpleResult = DataResult;

function isTrusted(deps: DataIpcDeps, event: IpcMainInvokeEvent): boolean {
  const window = deps.getWindow();
  return window !== undefined && !window.isDestroyed() && event.sender.id === window.webContents.id;
}

export function registerDataIpc(deps: DataIpcDeps): () => void {
  ipcMain.handle(DATA_CHANNELS.summary, (event): DataSummary | undefined => {
    if (!isTrusted(deps, event)) return undefined;
    return deps.manager.summary();
  });

  ipcMain.handle(DATA_CHANNELS.export, async (event, raw: unknown): Promise<SimpleResult> => {
    if (!isTrusted(deps, event)) return { ok: false, error: "来源窗口不可信" };
    if (!isDataSelection(raw)) return { ok: false, error: "导出选项不合法" };
    const window = deps.getWindow();
    if (window === undefined) return { ok: false, error: "窗口不可用" };

    const picked = await dialog.showSaveDialog(window, {
      title: "导出数据",
      defaultPath: defaultExportName(),
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    });
    if (picked.canceled || picked.filePath === undefined) return { ok: false, error: "已取消" };

    const result = deps.manager.exportTo(picked.filePath, raw);
    if (result.ok) deps.onChanged();
    return result;
  });

  ipcMain.handle(DATA_CHANNELS.import, async (event, raw: unknown): Promise<SimpleResult> => {
    if (!isTrusted(deps, event)) return { ok: false, error: "来源窗口不可信" };
    if (!isDataSelection(raw)) return { ok: false, error: "导入选项不合法" };
    const window = deps.getWindow();
    if (window === undefined) return { ok: false, error: "窗口不可用" };

    const picked = await dialog.showOpenDialog(window, {
      title: "导入数据",
      properties: ["openFile"],
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || file === undefined) return { ok: false, error: "已取消" };
    if (!existsSync(file)) return { ok: false, error: "文件不存在" };

    const result = deps.manager.importFrom(file, raw);
    if (result.ok) deps.onChanged();
    return result;
  });

  ipcMain.handle(DATA_CHANNELS.clear, (event, raw: unknown): SimpleResult => {
    if (!isTrusted(deps, event)) return { ok: false, error: "来源窗口不可信" };
    if (!isDataSelection(raw)) return { ok: false, error: "清除选项不合法" };
    const result = deps.manager.clear(raw as DataSelection);
    if (result.ok) deps.onChanged();
    return result;
  });

  return () => {
    for (const channel of DATA_CHANNEL_LIST) ipcMain.removeHandler(channel);
  };
}
