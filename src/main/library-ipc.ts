/**
 * 作品库设置的 IPC：读状态、换目录、在资源管理器里打开。
 *
 * 目录来自用户的系统对话框，不接受 renderer 传来的任意路径写入；
 * 这里仍会重新校验一次绝对路径，因为 renderer 不是安全边界。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import { isAbsoluteDirectory, normalizeLibraryDir, type ChooseLibraryDirResult, type LibrarySettingsView } from "@shared/library";
import type { FavoritesStore } from "./favorites-store";
import type { FileJobStore } from "./library-store";
import { resolveLibrarySettings } from "./library-store";

export const LIBRARY_CHANNELS = {
  view: "library:view",
  chooseDir: "library:choose-dir",
  openDir: "library:open-dir",
  rebuildIndex: "library:rebuild-index",
  deleteAsset: "library:delete-asset",
  favorites: "library:favorites",
  toggleFavorite: "library:toggle-favorite",
} as const;

export const LIBRARY_CHANNEL_LIST: readonly string[] = Object.values(LIBRARY_CHANNELS);

export interface LibraryIpcDeps {
  readonly getWindow: () => BrowserWindow | undefined;
  readonly store: FileJobStore;
  readonly favorites: FavoritesStore;
  /** 设置文件绝对路径。 */
  readonly settingsFile: string;
  /** 系统推荐目录（"图片"下的 Image Agent）。 */
  readonly defaultDir: string;
  readonly readFile?: (file: string) => string;
  readonly writeFile?: (file: string, data: string) => void;
  readonly mkdir?: (dir: string) => void;
}

type SimpleResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

function isTrusted(deps: LibraryIpcDeps, event: IpcMainInvokeEvent): boolean {
  const window = deps.getWindow();
  return window !== undefined && !window.isDestroyed() && event.sender.id === window.webContents.id;
}

export function registerLibraryIpc(deps: LibraryIpcDeps): () => void {
  const readFile = deps.readFile ?? ((file: string) => readFileSync(file, "utf8"));
  const writeFile = deps.writeFile ?? ((file: string, data: string) => writeFileSync(file, data, "utf8"));
  const mkdir = deps.mkdir ?? ((dir: string) => void mkdirSync(dir, { recursive: true }));

  /** 目录不可用（被删/无权限）时回退到默认目录，而不是让应用卡在坏配置上。 */
  const ensureDir = (candidate: string): { dir: string; warning?: string } => {
    try {
      mkdir(candidate);
      return { dir: candidate };
    } catch (error) {
      try {
        mkdir(deps.defaultDir);
        return { dir: deps.defaultDir, warning: `原目录不可用（${(error as Error).message}），已改用默认目录` };
      } catch {
        return { dir: deps.defaultDir, warning: "目录不可用，图片暂时只在内存里保留" };
      }
    }
  };

  const buildView = (): LibrarySettingsView => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFile(deps.settingsFile));
    } catch {
      parsed = undefined;
    }
    const settings = resolveLibrarySettings(parsed, deps.defaultDir);
    const ensured = ensureDir(settings.dir);
    const view: LibrarySettingsView = {
      settings: { dir: ensured.dir },
      defaultDir: deps.defaultDir,
      resolvedDir: deps.store.dir === "" ? ensured.dir : deps.store.dir,
      stats: deps.store.stats(),
      ...(deps.store.loadWarning === undefined ? {} : { lastLoadWarning: deps.store.loadWarning }),
      ...(ensured.warning === undefined ? {} : { lastLoadWarning: ensured.warning }),
    };
    return view;
  };

  ipcMain.handle(LIBRARY_CHANNELS.view, (event): LibrarySettingsView | undefined => {
    if (!isTrusted(deps, event)) return undefined;
    return buildView();
  });

  ipcMain.handle(LIBRARY_CHANNELS.chooseDir, async (event): Promise<ChooseLibraryDirResult> => {
    if (!isTrusted(deps, event)) return { ok: false, error: "来源窗口不可信" };
    const window = deps.getWindow();
    if (window === undefined) return { ok: false, error: "窗口不可用" };
    try {
      const result = await dialog.showOpenDialog(window, {
        title: "选择作品保存文件夹",
        defaultPath: deps.store.dir === "" ? deps.defaultDir : deps.store.dir,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: false, error: "已取消" };
      const chosen = result.filePaths[0];
      if (chosen === undefined || !isAbsoluteDirectory(chosen)) return { ok: false, error: "选择的路径不可用" };
      const dir = normalizeLibraryDir(chosen);
      deps.store.setDir(dir);
      try {
        mkdir(dir);
        writeFile(deps.settingsFile, JSON.stringify({ dir }, null, 2));
      } catch (error) {
        return { ok: false, error: `无法写入该目录：${(error as Error).message}` };
      }
      return { ok: true, dir };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(
    LIBRARY_CHANNELS.rebuildIndex,
    (event): { readonly ok: true; readonly recovered: number; readonly skipped: number } | { readonly ok: false; readonly message: string } => {
      if (!isTrusted(deps, event)) return { ok: false, message: "来源窗口不可信" };
      try {
        const result = deps.store.rebuildIndex();
        return { ok: true, recovered: result.recovered, skipped: result.skipped };
      } catch (error) {
        return { ok: false, message: (error as Error).message };
      }
    },
  );

  ipcMain.handle(LIBRARY_CHANNELS.deleteAsset, (event, raw: unknown): SimpleResult => {
    if (!isTrusted(deps, event)) return { ok: false, message: "来源窗口不可信" };
    if (typeof raw !== "string" || raw.trim() === "") return { ok: false, message: "缺少作品 ID" };
    const removed = deps.store.deleteAsset(raw);
    if (removed.ok) deps.favorites.forget(raw);
    return removed.ok ? { ok: true } : { ok: false, message: "这张作品不在了" };
  });

  ipcMain.handle(LIBRARY_CHANNELS.favorites, (event): readonly string[] => {
    if (!isTrusted(deps, event)) return [];
    return deps.favorites.list();
  });

  ipcMain.handle(LIBRARY_CHANNELS.toggleFavorite, (event, raw: unknown): { readonly favorite: boolean } => {
    if (!isTrusted(deps, event)) return { favorite: false };
    if (typeof raw !== "string" || raw.trim() === "") return { favorite: false };
    return deps.favorites.toggle(raw);
  });

  ipcMain.handle(LIBRARY_CHANNELS.openDir, async (event): Promise<SimpleResult> => {
    if (!isTrusted(deps, event)) return { ok: false, message: "来源窗口不可信" };
    const dir = deps.store.dir === "" ? deps.defaultDir : deps.store.dir;
    try {
      mkdir(dir);
    } catch {
      // 打不开就交给 openPath 报错。
    }
    const error = await shell.openPath(dir);
    return error === "" ? { ok: true } : { ok: false, message: error };
  });

  return () => {
    for (const channel of LIBRARY_CHANNEL_LIST) ipcMain.removeHandler(channel);
  };
}

/** 设置文件路径：userData/library-settings.json。 */
export function librarySettingsFile(userDataDir: string): string {
  return path.join(userDataDir, "library-settings.json");
}
