/**
 * 应用外壳相关的类型：自绘标题栏的窗口控制，以及"关于"页要用的环境信息。
 *
 * 与 image-generation.ts 一样，这个文件只能有类型和常量，不得导入 Node/Electron/DOM。
 */

export interface WindowControls {
  readonly minimize: () => Promise<void>;
  readonly toggleMaximize: () => Promise<boolean>;
  readonly close: () => Promise<void>;
  readonly isMaximized: () => Promise<boolean>;
}

/** main 提供的环境信息。"关于"页显示它，renderer 不需要自己猜版本。 */
export interface AppEnvironment {
  readonly appName: string;
  readonly appVersion: string;
  readonly electronVersion: string;
  readonly chromeVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  /** 真实服务是否已配置。只告诉 UI 有没有，不含任何密钥片段。 */
  readonly providerConfigured: boolean;
  /** 真实服务地址（用户自己填的 baseUrl）；未配置时省略。 */
  readonly providerBaseUrl?: string;
  /** 已注册的模型 ID 列表，用于"服务商"页展示。 */
  readonly models: readonly string[];
}

export const APP_CHANNEL = "app:environment";

/** 自绘菜单里的"编辑"动作：交给 Electron 处理，才能作用到当前焦点控件。 */
export const EDIT_ACTIONS = ["undo", "redo", "cut", "copy", "paste", "delete", "selectAll"] as const;

export type EditAction = (typeof EDIT_ACTIONS)[number];

export const EDIT_CHANNEL = "app:edit";

export function isEditAction(value: unknown): value is EditAction {
  return typeof value === "string" && (EDIT_ACTIONS as readonly string[]).includes(value);
}
