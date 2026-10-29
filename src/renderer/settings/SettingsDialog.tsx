/**
 * 设置弹窗：API 设置 / 外观设置 / 关于。
 *
 * API 设置的密钥只由 main 保存与使用：界面可以填一把新的，但读回来永远是空的，
 * 因此不存在"密钥进 localStorage、截图或 React DevTools"的可能。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppEnvironment } from "../../shared/app-shell.ts";
import type { ProviderSettingsView } from "../../shared/provider-settings.ts";
import { ApiSettingsPanel } from "./ApiSettingsPanel.tsx";
import { LibrarySettingsPanel } from "./LibrarySettingsPanel.tsx";

export type SettingsTab = "api" | "appearance" | "storage" | "about";

export interface SettingsDialogProps {
  readonly initialTab: SettingsTab;
  readonly environment: AppEnvironment | undefined;
  readonly providerCount: number;
  readonly modelCount: number;
  readonly theme: "auto" | "light" | "dark";
  readonly onThemeChange: (theme: "auto" | "light" | "dark") => void;
  readonly density: "comfortable" | "compact";
  readonly onDensityChange: (density: "comfortable" | "compact") => void;
  readonly onClose: () => void;
}

const TABS: readonly { readonly id: SettingsTab; readonly label: string }[] = [
  { id: "api", label: "API 设置" },
  { id: "appearance", label: "外观设置" },
  { id: "storage", label: "存储" },
  { id: "about", label: "关于" },
];

export function SettingsDialog({
  initialTab,
  environment,
  providerCount,
  modelCount,
  theme,
  onThemeChange,
  density,
  onDensityChange,
  onClose,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [providerView, setProviderView] = useState<ProviderSettingsView>();
  const [settingsLoading, setSettingsLoading] = useState(true);

  const refreshProviderView = useCallback(() => {
    setSettingsLoading(true);
    void window.appSettings
      ?.view()
      .then((value) => setProviderView(value))
      .catch(() => setProviderView(undefined))
      .finally(() => setSettingsLoading(false));
  }, []);

  useEffect(() => {
    refreshProviderView();
  }, [refreshProviderView]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="设置">
        <header className="modal__head">
          <h2>设置</h2>
          <button ref={closeRef} type="button" className="modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="settings">
          <nav className="settings__tabs" aria-label="设置分类">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`settings__tab ${tab === entry.id ? "is-active" : ""}`}
                aria-current={tab === entry.id ? "page" : undefined}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          <div className="settings__body">
            {tab === "api" && (
              <>
                <ApiSettingsPanel view={providerView} loading={settingsLoading} onRefresh={refreshProviderView} />
                <details className="settings__more">
                  <summary>当前生效状态</summary>
                  <dl className="facts">
                    <div className="fact">
                      <dt>状态</dt>
                      <dd>
                        {environment?.providerConfigured ? (
                          <span className="badge badge--ok">已启用真实服务</span>
                        ) : (
                          <span className="badge badge--muted">只有离线假服务</span>
                        )}
                      </dd>
                    </div>
                    <div className="fact">
                      <dt>接口地址</dt>
                      <dd className="fact--mono">{environment?.providerBaseUrl ?? "—"}</dd>
                    </div>
                    <div className="fact">
                      <dt>模型</dt>
                      <dd className="fact--mono">{environment?.models.length ? environment.models.join("、") : "—"}</dd>
                    </div>
                    <div className="fact">
                      <dt>可用服务</dt>
                      <dd>
                        {providerCount} 个服务 · {modelCount} 个模型（含离线假服务）
                      </dd>
                    </div>
                  </dl>
                </details>
              </>
            )}
            {tab === "appearance" && (
              <section className="settings__section" aria-label="外观设置">
                <h3>主题</h3>
                <div className="chips" role="radiogroup" aria-label="主题">
                  {(
                    [
                      { value: "auto", label: "跟随系统" },
                      { value: "light", label: "白天" },
                      { value: "dark", label: "黑夜" },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={theme === option.value}
                      className={`chip ${theme === option.value ? "is-active" : ""}`}
                      onClick={() => onThemeChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <h3>密度</h3>
                <div className="chips" role="radiogroup" aria-label="密度">
                  {(
                    [
                      { value: "comfortable", label: "宽松" },
                      { value: "compact", label: "紧凑" },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={density === option.value}
                      className={`chip ${density === option.value ? "is-active" : ""}`}
                      onClick={() => onDensityChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="field__hint">\n                  「跟随系统」会随操作系统的浅色/深色设置自动切换。外观只保存在本机页面存储里，不影响生成结果。\n                </p>
              </section>
            )}

            {tab === "storage" && <LibrarySettingsPanel />}

            {tab === "about" && (
              <section className="settings__section" aria-label="关于">
                <h3>Image Agent</h3>
                <p className="field__hint">本地优先的自然语言生图桌面应用。</p>
                <dl className="facts">
                  <div className="fact">
                    <dt>版本</dt>
                    <dd className="fact--mono">{environment?.appVersion ?? "—"}</dd>
                  </div>
                  <div className="fact">
                    <dt>Electron</dt>
                    <dd className="fact--mono">{environment?.electronVersion ?? "—"}</dd>
                  </div>
                  <div className="fact">
                    <dt>Chromium / Node</dt>
                    <dd className="fact--mono">
                      {environment?.chromeVersion ?? "—"} / {environment?.nodeVersion ?? "—"}
                    </dd>
                  </div>
                  <div className="fact">
                    <dt>平台</dt>
                    <dd className="fact--mono">{environment?.platform ?? "—"}</dd>
                  </div>
                </dl>
                <p className="field__hint">
                  作品与任务记录目前只保存在内存中，关闭应用即清空。截图、图片与任务都不出本机，
                  只有生成请求会发送到你配置的服务商。
                </p>
              </section>
            )}
          </div>
        </div>

        <footer className="modal__foot">
          <button type="button" className="button button--ghost" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
