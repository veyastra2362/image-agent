/**
 * 设置弹窗：API 设置 / 外观设置 / 关于。
 *
 * API 设置的密钥只由 main 保存与使用：界面可以填一把新的，但读回来永远是空的，
 * 因此不存在"密钥进 localStorage、截图或 React DevTools"的可能。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "../shell/icons.tsx";
import type { AppEnvironment } from "../../shared/app-shell.ts";
import type { ProviderSettingsView } from "../../shared/provider-settings.ts";
import { ApiSettingsPanel, type FooterAction } from "./ApiSettingsPanel.tsx";
import { LibrarySettingsPanel } from "./LibrarySettingsPanel.tsx";
import { DataSettingsPanel } from "./DataSettingsPanel.tsx";
import { Select } from "../shell/Select.tsx";
import { FONT_OPTIONS, FONT_SIZE_RANGE, type FontPreference as FontFamily, type LanguagePreference } from "../lib/appearance.ts";
import { LANGUAGES, useT, type I18nKey } from "../lib/i18n.ts";
import { PALETTE_OPTIONS, type PalettePreference } from "../lib/appearance.ts";
import { FolderIcon, SlidersIcon } from "../shell/icons.tsx";

export type SettingsTab = "api" | "appearance" | "storage" | "data" | "about";

export interface SettingsDialogProps {
  readonly initialTab: SettingsTab;
  readonly environment: AppEnvironment | undefined;
  readonly providerCount: number;
  readonly modelCount: number;
  /** 离线假服务的模型数（正式运行通常是 0）。 */
  readonly fakeModelCount: number;
  readonly theme: "auto" | "light" | "dark";
  readonly onThemeChange: (theme: "auto" | "light" | "dark") => void;
  readonly density: "comfortable" | "compact";
  readonly onDensityChange: (density: "comfortable" | "compact") => void;
  readonly palette: PalettePreference;
  readonly resultRows: number;
  readonly onResultRowsChange: (rows: number) => void;
  readonly onPaletteChange: (palette: PalettePreference) => void;
  readonly fontSize: number;
  readonly onFontSizeChange: (size: number) => void;
  readonly fontFamily: FontFamily;
  readonly onFontFamilyChange: (family: FontFamily) => void;
  readonly language: LanguagePreference;
  readonly onLanguageChange: (language: LanguagePreference) => void;
  readonly onClose: () => void;
}

const TABS: readonly { readonly id: SettingsTab; readonly labelKey: I18nKey; readonly icon: ReactNode }[] = [
  { id: "api", labelKey: "settings.tab.api", icon: <PlugIcon /> },
  { id: "appearance", labelKey: "settings.tab.general", icon: <SlidersIcon size={13} /> },
  { id: "storage", labelKey: "settings.tab.storage", icon: <FolderIcon size={13} /> },
  { id: "data", labelKey: "settings.tab.data", icon: <DatabaseIcon /> },
  { id: "about", labelKey: "settings.tab.about", icon: <InfoIcon /> },
];

/** 设置页签用的小图标：统一 13px、1.3 线宽，和别处图标一致。 */
function PlugIcon({ size = 13 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6 2v3M10 2v3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4 5h8v2.4a4 4 0 0 1-8 0Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 11.4V14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function DatabaseIcon({ size = 13 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <ellipse cx="8" cy="4" rx="5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function InfoIcon({ size = 13 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.2v4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** 外观选择：卡片式，下面有一块跟着选项左右滑动的底色。 */
function ChoiceCards<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string; readonly icon: ReactNode }[];
  readonly onChange: (value: T) => void;
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div
      className="choice-cards"
      role="radiogroup"
      aria-label={label}
      style={{ "--n": options.length, "--i": index } as CSSProperties}
    >
      <span className="choice-cards__thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`choice-card ${value === option.value ? "is-active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          <span className="choice-card__icon">{option.icon}</span>
          <span className="choice-card__label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}


/** 配色选择：每个选项画两个小色块（底 + 强调），选中态与主题卡片一致。 */
function PaletteCards({
  value,
  onChange,
}: {
  readonly value: PalettePreference;
  readonly onChange: (next: PalettePreference) => void;
}) {
  return (
    <div className="palette-cards" role="radiogroup" aria-label="配色">
      {PALETTE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`palette-card ${value === option.value ? "is-active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          <span className={`palette-card__swatch palette-card__swatch--${option.value}`} aria-hidden="true">
            <i></i>
            <i></i>
          </span>
          <span className="palette-card__text">
            <span className="palette-card__label">{option.label}</span>
            <span className="field__hint">{option.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function SettingsDialog({
  initialTab,
  environment,
  providerCount,
  modelCount,
  fakeModelCount,
  theme,
  onThemeChange,
  density,
  onDensityChange,
  palette,
  onPaletteChange,
  resultRows,
  onResultRowsChange,
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

  // 两个用途分开统计：图片模型走 /images，语言模型走 /chat，混在一起会误导。
  const textProfiles = (providerView?.profiles ?? []).filter(
    (profile) => (profile.purpose ?? "image") === "text" && profile.baseUrl !== "" && profile.models.length > 0,
  );
  const textServiceCount = textProfiles.length;
  const textModelCount = textProfiles.reduce((sum, profile) => sum + profile.models.length, 0);
  const textBaseUrl = textProfiles[0]?.baseUrl;
  const imageBaseUrl = (providerView?.profiles ?? []).find(
    (profile) => (profile.purpose ?? "image") === "image" && profile.baseUrl !== "",
  )?.baseUrl;
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
                <span className="settings__tab-icon" aria-hidden="true">
                  {entry.icon}
                </span>
                <span>{t(entry.labelKey)}</span>
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
                      <dt>图片模型</dt>
                      <dd>
                        {providerCount} 个服务 · {modelCount} 个模型
                        {fakeModelCount > 0 ? `（其中 ${fakeModelCount} 个是离线假服务）` : ""}
                        {providerCount === 0 ? "（未配置）" : ""}
                      </dd>
                    </div>
                    <div className="fact">
                      <dt>语言模型</dt>
                      <dd>
                        {textServiceCount} 个服务 · {textModelCount} 个模型
                        {textServiceCount === 0 ? "（未配置，Agent 优化不可用）" : ""}
                      </dd>
                    </div>
                    <div className="fact">
                      <dt>图片接口</dt>
                      <dd className="fact--mono">{imageBaseUrl ?? "—"}</dd>
                    </div>
                    <div className="fact">
                      <dt>语言接口</dt>
                      <dd className="fact--mono">{textBaseUrl ?? "—"}</dd>
                    </div>
                  </dl>
                </details>
              </>
            )}
            {tab === "appearance" && (
              <section className="settings__section" aria-label="通用设置">
                <h3>{t("general.theme")}</h3>
                <ChoiceCards
                  label={t("general.theme")}
                  value={theme}
                  onChange={onThemeChange}
                  options={[
                    { value: "light", label: t("general.theme.light"), icon: <SunIcon /> },
                    { value: "dark", label: t("general.theme.dark"), icon: <MoonIcon /> },
                    { value: "auto", label: t("general.theme.auto"), icon: <MonitorIcon /> },
                  ]}
                />
                <h3>配色</h3>
                <PaletteCards value={palette} onChange={onPaletteChange} />
                <h3>结果区行数</h3>
                <div className="settings__row settings__row--field">
                  <div>
                    <div className="field__label">默认显示几行图片</div>
                    <div className="field__hint">1~3 行；一次出图更多时折叠成「查看全部」。</div>
                  </div>
                  <div
                    className="row-choices"
                    role="group"
                    aria-label="结果区默认显示行数"
                    style={{ "--row-index": resultRows - 1 } as CSSProperties}
                  >
                    {/* 滑块：跟着选中项平移，不要突然跳过去 */}
                    <span className="row-choices__thumb" aria-hidden="true" />
                    {[1, 2, 3].map((rows) => (
                      <button
                        key={rows}
                        type="button"
                        className={`row-choices__item ${resultRows === rows ? "is-active" : ""}`}
                        aria-pressed={resultRows === rows}
                        onClick={() => onResultRowsChange(rows)}
                      >
                        {rows} 行
                      </button>
                    ))}
                  </div>
                </div>
                <h3>{t("general.density")}</h3>
                <Select
                  ariaLabel={t("general.density")}
                  value={density}
                  onChange={(next) => onDensityChange(next as "comfortable" | "compact")}
                  options={[
                    { value: "comfortable", label: t("general.density.comfortable") },
                    { value: "compact", label: t("general.density.compact") },
                  ]}
                />
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
