/**
 * 设置弹窗：API 设置 / 外观设置 / 关于。
 *
 * API 设置的密钥只由 main 保存与使用：界面可以填一把新的，但读回来永远是空的，
 * 因此不存在"密钥进 localStorage、截图或 React DevTools"的可能。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppEnvironment } from "../../shared/app-shell.ts";
import type { ProviderSettingsView } from "../../shared/provider-settings.ts";
import { ApiSettingsPanel, type FooterAction } from "./ApiSettingsPanel.tsx";
import { LibrarySettingsPanel } from "./LibrarySettingsPanel.tsx";
import { DataSettingsPanel } from "./DataSettingsPanel.tsx";
import { Select } from "../shell/Select.tsx";
import { FONT_OPTIONS, FONT_SIZE_RANGE, type FontPreference as FontFamily, type LanguagePreference } from "../lib/appearance.ts";
import { LANGUAGES, useT, type I18nKey } from "../lib/i18n.ts";

export type SettingsTab = "api" | "appearance" | "storage" | "data" | "about";

export interface SettingsDialogProps {
  readonly initialTab: SettingsTab;
  readonly environment: AppEnvironment | undefined;
  readonly providerCount: number;
  readonly modelCount: number;
  readonly theme: "auto" | "light" | "dark";
  readonly onThemeChange: (theme: "auto" | "light" | "dark") => void;
  readonly density: "comfortable" | "compact";
  readonly onDensityChange: (density: "comfortable" | "compact") => void;
  readonly fontSize: number;
  readonly onFontSizeChange: (size: number) => void;
  readonly fontFamily: FontFamily;
  readonly onFontFamilyChange: (family: FontFamily) => void;
  readonly language: LanguagePreference;
  readonly onLanguageChange: (language: LanguagePreference) => void;
  readonly onClose: () => void;
}

const TABS: readonly { readonly id: SettingsTab; readonly labelKey: I18nKey }[] = [
  { id: "api", labelKey: "settings.tab.api" },
  { id: "appearance", labelKey: "settings.tab.general" },
  { id: "storage", labelKey: "settings.tab.storage" },
  { id: "data", labelKey: "settings.tab.data" },
  { id: "about", labelKey: "settings.tab.about" },
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
  fontSize,
  onFontSizeChange,
  fontFamily,
  onFontFamilyChange,
  language,
  onLanguageChange,
  onClose,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [providerView, setProviderView] = useState<ProviderSettingsView>();
  const [settingsLoading, setSettingsLoading] = useState(true);
  // API 面板把"保存"注册到这里，统一放在弹窗底部（关闭按钮旁边）。
  const [footerAction, setFooterAction] = useState<FooterAction>();
  const t = useT();

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
          <h2>{t("settings.title")}</h2>
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
                {t(entry.labelKey)}
              </button>
            ))}
          </nav>

          <div className="settings__body">
            {tab === "api" && (
              <>
                <ApiSettingsPanel
                  view={providerView}
                  loading={settingsLoading}
                  onRefresh={refreshProviderView}
                  onFooterChange={setFooterAction}
                />
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
              <section className="settings__section" aria-label="通用设置">
                <h3>{t("general.theme")}</h3>
                <div className="chips" role="radiogroup" aria-label={t("general.theme")}>
                  {(
                    [
                      { value: "auto", label: t("general.theme.auto") },
                      { value: "light", label: t("general.theme.light") },
                      { value: "dark", label: t("general.theme.dark") },
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
                <h3>{t("general.density")}</h3>
                <div className="chips" role="radiogroup" aria-label={t("general.density")}>
                  {(
                    [
                      { value: "comfortable", label: t("general.density.comfortable") },
                      { value: "compact", label: t("general.density.compact") },
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
                <div className="settings__row settings__row--field">
                  <div>
                    <div className="field__label">{t("general.fontSize")}</div>
                    <div className="field__hint">{t("general.fontSizeHint")}</div>
                  </div>
                  <div className="font-size-control">
                    <input
                      className="field__input font-size-control__input"
                      type="number"
                      min={FONT_SIZE_RANGE.min}
                      max={FONT_SIZE_RANGE.max}
                      value={fontSize}
                      aria-label="字号大小"
                      onChange={(event) => onFontSizeChange(Number(event.target.value))}
                    />
                    <span className="font-size-control__unit">px</span>
                  </div>
                </div>
                <label className="field">
                  <span className="field__label">{t("general.font")}</span>
                  <Select
                    ariaLabel="字体"
                    value={fontFamily}
                    onChange={(next) => onFontFamilyChange(next as FontFamily)}
                    options={FONT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  />
                </label>
                <label className="field">
                  <span className="field__label">{t("general.language")}</span>
                  <Select
                    ariaLabel={t("general.language")}
                    value={language}
                    onChange={(next) => onLanguageChange(next as LanguagePreference)}
                    options={LANGUAGES.map((option) => ({ value: option.value, label: option.label }))}
                  />
                  <span className="field__hint">{t("general.languageHint")}</span>
                </label>
                <p className="field__hint">{t("general.themeHint")}</p>
              </section>
            )}

            {tab === "storage" && <LibrarySettingsPanel />}

            {tab === "data" && <DataSettingsPanel />}

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
                  任务与图片会保存到本机作品目录，配置与密钥保存在应用数据目录，重启应用后仍在。
                  图片与任务不会离开本机，只有生成请求（提示词与参数）会发送到你配置的服务商。
                </p>
              </section>
            )}
          </div>
        </div>

        <footer className="modal__foot">
          {footerAction !== undefined && (
            <button
              type="button"
              className="button button--primary"
              disabled={footerAction.disabled}
              onClick={footerAction.onClick}
            >
              {footerAction.label}
            </button>
          )}
          <button type="button" className="button button--ghost" onClick={onClose}>
            {t("settings.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}
