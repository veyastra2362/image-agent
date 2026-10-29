/**
 * Renderer 可调用的窄接口。
 *
 * preload 通过 contextBridge 暴露 `window.imageAgent` / `window.appWindow` / `window.appInfo`，
 * 形状必须与此文件一致。renderer 拿不到 ipcRenderer、ipcMain、channel 字符串，
 * 也拿不到任意 invoke。
 */
import type { ImageAgentApi as ImageAgentIpcApi } from "./image-generation.ts";
import type { AppEnvironment, EditAction, WindowControls } from "./app-shell.ts";
import type { ChooseLibraryDirResult, LibrarySettingsView } from "./library.ts";
import type { DataResult, DataSelection, DataSummary } from "./data-management.ts";
import type { ModelFetchResult, ProviderProfile, ProviderSettingsView, ProviderTestResult } from "./provider-settings.ts";

/** Renderer 拿到的 API；结果类型在通道两侧是同一个对象。 */
export type ImageAgentApi = ImageAgentIpcApi;

declare global {
  interface Window {
    readonly imageAgent: ImageAgentApi;
    /** 自绘标题栏的窗口控制；不可用时（例如浏览器里）为 undefined。 */
    readonly appWindow?: WindowControls;
    /** 版本与配置状态；不含任何密钥。 */
    readonly appInfo?: {
      readonly environment: () => Promise<AppEnvironment>;
      /** 编辑命令由 main 转给 webContents，才能作用到当前焦点控件。 */
      readonly edit: (action: EditAction) => Promise<boolean>;
    };
    /** 服务商连接设置；返回的视图里永远没有密钥本体。 */
    readonly appSettings?: {
      readonly view: () => Promise<ProviderSettingsView | undefined>;
      readonly save: (payload: {
        readonly profile: ProviderProfile;
        readonly apiKey?: string;
        readonly clearApiKey?: boolean;
      }) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
      readonly remove: (id: string) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
      readonly activate: (id: string) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
      readonly create: () => Promise<
        { readonly ok: true; readonly profile: ProviderProfile } | { readonly ok: false; readonly message: string }
      >;
      readonly test: (payload?: {
        readonly id?: string;
        readonly settings?: ProviderProfile;
        readonly apiKey?: string;
      }) => Promise<ProviderTestResult>;
      readonly fetchModels: (payload?: {
        readonly id?: string;
        readonly settings?: ProviderProfile;
        readonly apiKey?: string;
      }) => Promise<ModelFetchResult>;
    };
    /** 数据导出/导入/清除；文件路径只能来自系统对话框。 */
    readonly appData?: {
      readonly summary: () => Promise<DataSummary | undefined>;
      readonly export: (selection: DataSelection) => Promise<DataResult>;
      readonly import: (selection: DataSelection) => Promise<DataResult>;
      readonly clear: (selection: DataSelection) => Promise<DataResult>;
    };
    /** 作品库落盘位置；目录只能通过系统对话框选择。 */
    readonly appLibrary?: {
      readonly view: () => Promise<LibrarySettingsView | undefined>;
      readonly chooseDir: () => Promise<ChooseLibraryDirResult>;
      readonly openDir: () => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
    };
  }
}
