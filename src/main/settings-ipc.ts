/**
 * 设置相关的 IPC：读视图、保存/删除/切换服务商、测试连通性、拉模型列表。
 *
 * 密钥的规矩：
 *  - renderer → main 允许带 apiKey（这是用户刚输入的、要保存的那把）
 *  - main → renderer 永远不带 apiKey，只带 hasApiKey / apiKeyFromEnv / apiKeyEncrypted
 *
 * 保存之后不会自动重建 provider 表——那是调用方（main）的事，这里只负责收和存。
 */
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import type { ModelFetchResult, ProviderSettingsView, ProviderTestResult } from "@shared/provider-settings";
import { validateProviderProfile, validateProviderSettings } from "@shared/provider-settings";
import type { ProviderSettingsStore } from "./provider-settings-store";
import { fetchUpstreamModels } from "./upstream-probe";

export const SETTINGS_CHANNELS = {
  view: "provider:settings-view",
  save: "provider:settings-save",
  remove: "provider:settings-remove",
  activate: "provider:settings-activate",
  create: "provider:settings-create",
  test: "provider:settings-test",
  fetchModels: "provider:fetch-models",
} as const;

export const SETTINGS_CHANNEL_LIST: readonly string[] = Object.values(SETTINGS_CHANNELS);

export interface SettingsIpcDeps {
  readonly getWindow: () => BrowserWindow | undefined;
  readonly store: ProviderSettingsStore;
  /** 密钥是否来自 .env / 环境变量。 */
  readonly envApiKeyPresent: () => boolean;
  /** 保存成功后重建 provider 表；返回是否成功，失败文案会带回界面。 */
  readonly applyProviders: () => { readonly ok: true } | { readonly ok: false; readonly error: string };
  /** 测试注入。 */
  readonly fetchModels?: typeof fetchUpstreamModels;
}

type Result = { readonly ok: true } | { readonly ok: false; readonly message: string };

function isTrustedSender(deps: SettingsIpcDeps, event: IpcMainInvokeEvent): boolean {
  const window = deps.getWindow();
  return window !== undefined && !window.isDestroyed() && event.sender.id === window.webContents.id;
}

export function registerSettingsIpc(deps: SettingsIpcDeps): () => void {
  const probe = deps.fetchModels ?? fetchUpstreamModels;

  /** 界面上刚输入的密钥优先；没填就用已保存的。 */
  const keyFor = (profileId: string, provided: unknown): string | undefined => {
    const fromUi = typeof provided === "string" ? provided.trim() : "";
    if (fromUi !== "") return fromUi;
    return deps.store.keyFor(profileId);
  };

  ipcMain.handle(SETTINGS_CHANNELS.view, (event): ProviderSettingsView | undefined => {
    if (!isTrustedSender(deps, event)) return undefined;
    return deps.store.view(deps.envApiKeyPresent());
  });

  ipcMain.handle(SETTINGS_CHANNELS.save, (event, raw: unknown): Result => {
    if (!isTrustedSender(deps, event)) return { ok: false, message: "来源窗口不可信" };
    if (typeof raw !== "object" || raw === null) return { ok: false, message: "设置格式不正确" };
    const record = raw as Record<string, unknown>;

    const validated = validateProviderProfile(record.profile);
    if (!validated.ok) return { ok: false, message: validated.error };
    const profile = validated.value;

    const apiKey = typeof record.apiKey === "string" ? record.apiKey : undefined;
    if (apiKey !== undefined && apiKey.trim().length > 512) return { ok: false, message: "API Key 过长" };
    if (apiKey !== undefined && /\s/.test(apiKey.trim())) return { ok: false, message: "API Key 不能包含空格" };

    if (deps.envApiKeyPresent() && apiKey !== undefined && apiKey.trim() !== "") {
      // 环境里的密钥优先，界面上的输入不生效；说清楚比默默无视好。
      return { ok: false, message: "当前 API Key 来自 .env 或环境变量，界面不能覆盖；请直接修改文件后重启应用" };
    }

    deps.store.upsert(profile);
    if (record.clearApiKey === true) deps.store.clearApiKey(profile.id);
    else if (apiKey !== undefined && apiKey.trim() !== "" && !deps.envApiKeyPresent()) {
      deps.store.setApiKey(profile.id, apiKey);
    }

    const applied = deps.applyProviders();
    return applied.ok ? { ok: true } : { ok: false, message: applied.error };
  });

  ipcMain.handle(SETTINGS_CHANNELS.remove, (event, raw: unknown): Result => {
    if (!isTrustedSender(deps, event)) return { ok: false, message: "来源窗口不可信" };
    if (typeof raw !== "string") return { ok: false, message: "缺少服务商 ID" };
    const removed = deps.store.remove(raw);
    if (!removed.ok) return { ok: false, message: removed.error };
    const applied = deps.applyProviders();
    return applied.ok ? { ok: true } : { ok: false, message: applied.error };
  });

  ipcMain.handle(SETTINGS_CHANNELS.activate, (event, raw: unknown): Result => {
    if (!isTrustedSender(deps, event)) return { ok: false, message: "来源窗口不可信" };
    if (typeof raw !== "string" || !deps.store.setActive(raw)) return { ok: false, message: "服务商不存在" };
    return { ok: true };
  });

  ipcMain.handle(
    SETTINGS_CHANNELS.create,
    (event): { readonly ok: true; readonly profile: unknown } | { readonly ok: false; readonly message: string } => {
      if (!isTrustedSender(deps, event)) return { ok: false, message: "来源窗口不可信" };
      try {
        const profile = deps.store.create();
        const applied = deps.applyProviders();
        if (!applied.ok) return { ok: false, message: applied.error };
        return { ok: true, profile };
      } catch (error) {
        return { ok: false, message: (error as Error).message };
      }
    },
  );

  ipcMain.handle(SETTINGS_CHANNELS.test, async (event, raw: unknown): Promise<ProviderTestResult> => {
    if (!isTrustedSender(deps, event)) return { ok: false, error: "来源窗口不可信" };
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const validated = validateProviderSettings(record.settings ?? record.profile);
    if (!validated.ok) return { ok: false, error: validated.error };

    const profileId = typeof record.id === "string" ? record.id : deps.store.activeId;
    const key = keyFor(profileId, record.apiKey);
    if (key === undefined || key === "") return { ok: false, error: "还没有填写 API Key" };

    const result = await probe({ kind: validated.value.kind, baseUrl: validated.value.baseUrl, apiKey: key });
    return result.ok
      ? { ok: true, models: result.models, message: `连通正常，上游返回 ${result.models.length} 个模型` }
      : { ok: false, error: result.error };
  });

  ipcMain.handle(SETTINGS_CHANNELS.fetchModels, async (event, raw: unknown): Promise<ModelFetchResult> => {
    if (!isTrustedSender(deps, event)) return { ok: false, error: "来源窗口不可信" };
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const validated = validateProviderSettings(record.settings ?? record.profile);
    if (!validated.ok) return { ok: false, error: validated.error };

    const profileId = typeof record.id === "string" ? record.id : deps.store.activeId;
    const key = keyFor(profileId, record.apiKey);
    if (key === undefined || key === "") return { ok: false, error: "还没有填写 API Key" };

    return probe({ kind: validated.value.kind, baseUrl: validated.value.baseUrl, apiKey: key });
  });

  return () => {
    for (const channel of SETTINGS_CHANNEL_LIST) ipcMain.removeHandler(channel);
  };
}
