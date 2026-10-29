/**
 * 应用外壳：自绘标题栏（菜单 + 导航 + 窗口按钮）、左侧配置栏、右侧画布与提示词输入框。
 *
 * 系统菜单已被去掉（Menu.setApplicationMenu(null)），"应用 / 编辑"由 MenuBar 自绘。
 */
import { useCallback, useEffect, useState } from "react";
import type { AppEnvironment } from "../shared/app-shell.ts";
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from "./lib/appearance.ts";
import { setLang, useT } from "./lib/i18n.ts";
import { ComposerProvider } from "./image/composer-state.tsx";
import { ConfigSidebar } from "./image/ConfigSidebar.tsx";
import { DetailsDrawer } from "./image/DetailsDrawer.tsx";
import { JobList } from "./image/JobList.tsx";
import { LibraryView } from "./image/LibraryView.tsx";
import { PromptDock } from "./image/PromptDock.tsx";
import { ResultCanvas } from "./image/ResultCanvas.tsx";
import { useImageAgent } from "./image/use-image-agent.ts";
import { SettingsDialog, type SettingsTab } from "./settings/SettingsDialog.tsx";
import { MenuBar } from "./shell/MenuBar.tsx";
import { PanelLeftIcon } from "./shell/PanelLeftIcon.tsx";
import { CloseIcon, GearIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from "./shell/icons.tsx";

type View = "create" | "library";

// 服务商页已下线：参数改在「设置 → API 设置」的模型条目里展开查看。
const VIEWS: readonly { readonly id: View; readonly labelKey: "nav.create" | "nav.library" }[] = [
  { id: "create", labelKey: "nav.create" },
  { id: "library", labelKey: "nav.library" },
];

export function App() {
  const state = useImageAgent();
  const t = useT();
  const [view, setView] = useState<View>("create");
  const [focusPrompt, setFocusPrompt] = useState(0);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>();
  const [environment, setEnvironment] = useState<AppEnvironment>();
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    applyAppearance(appearance);
    saveAppearance(appearance);
    setLang(appearance.language);
  }, [appearance]);

  useEffect(() => {
    void window.appInfo
      ?.environment()
      .then((value) => setEnvironment(value))
      .catch(() => undefined);
    void window.appWindow?.isMaximized().then((value) => setMaximized(value === true));
  }, []);

  // N（不在输入框中时）把焦点送回提示词，方便连续创作。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (!typing && !event.ctrlKey && !event.metaKey && (event.key === "n" || event.key === "N")) {
        setView("create");
        setFocusPrompt((value) => value + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl+B 收起/展开配置栏；输入框里也生效，和常见编辑器一致。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setAppearance((current) => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleMaximize = useCallback(async () => {
    const next = await window.appWindow?.toggleMaximize();
    setMaximized(next === true);
  }, []);

  // 快速连点开关时，第二次点击会被当成标题栏双击 → 最大化。
  // 交互控件上的双击必须忽略，否则"收起点太快"会变成"全屏"。
  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("button, input, textarea, select, .menubar, .select") !== null) return;
      void toggleMaximize();
    },
    [toggleMaximize],
  );

  return (
    <div className="app">
      <header className="titlebar" onDoubleClick={handleDoubleClick}>
        <div className="titlebar__lead">
          <button
            type="button"
            className={`titlebar__toggle ${appearance.sidebarCollapsed ? "" : "is-open"}`}
            aria-pressed={!appearance.sidebarCollapsed}
            aria-label={appearance.sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            title={`${appearance.sidebarCollapsed ? "展开" : "收起"}侧栏（Ctrl+B）`}
            onClick={() => setAppearance((current) => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }))}
          >
            <PanelLeftIcon />
          </button>
          <MenuBar
            onOpenSettings={() => setSettingsTab("api")}
            onOpenLibraryFolder={() => void window.appLibrary?.openDir()}
            onQuit={() => void window.appWindow?.close()}
          />
        </div>

        <nav className="titlebar__nav" aria-label="主导航">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`navitem ${view === entry.id ? "is-active" : ""}`}
              aria-current={view === entry.id ? "page" : undefined}
              onClick={() => setView(entry.id)}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </nav>

        <div className="titlebar__actions">
          <button
            type="button"
            className="titlebar__icon"
            aria-label="设置"
            title="设置"
            onClick={() => setSettingsTab("api")}
          >
            <GearIcon />
          </button>
          <span className="titlebar__divider" aria-hidden="true" />
          <button
            type="button"
            className="window-btn"
            aria-label="最小化"
            title="最小化"
            onClick={() => void window.appWindow?.minimize()}
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            className="window-btn"
            aria-label={maximized ? "还原" : "最大化"}
            title={maximized ? "还原" : "最大化"}
            onClick={() => void toggleMaximize()}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
          <button
            type="button"
            className="window-btn window-btn--close"
            aria-label="关闭"
            title="关闭"
            onClick={() => void window.appWindow?.close()}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      {view === "create" && (
        <ComposerProvider
          state={state}
          models={state.models}
          onSubmitted={() => undefined}
          focusPromptToken={focusPrompt}
        >
          <div className={`shell ${appearance.sidebarCollapsed ? "is-collapsed" : ""}`}>
            <aside className="sidebar" aria-label="创作配置">
              <ConfigSidebar onCollapse={() => setAppearance((current) => ({ ...current, sidebarCollapsed: true }))} />
              <JobList state={state} onOpenAsset={state.openAsset} />
            </aside>

            <main className="workspace">
              <ResultCanvas state={state} onOpenAsset={state.openAsset} />
              <PromptDock />
            </main>
          </div>
        </ComposerProvider>
      )}

      {view === "library" && (
        <main className="workspace workspace--page">
          <LibraryView state={state} onOpenAsset={state.openAsset} />
        </main>
      )}


      {state.selectedAssetId && <DetailsDrawer state={state} onClose={state.closeDrawer} />}

      {settingsTab && (
        <SettingsDialog
          initialTab={settingsTab}
          environment={environment}
          providerCount={new Set(state.models.map((model) => model.id)).size}
          modelCount={state.models.length}
          theme={appearance.theme}
          density={appearance.density}
          onThemeChange={(theme) => setAppearance((current) => ({ ...current, theme }))}
          onDensityChange={(density) => setAppearance((current) => ({ ...current, density }))}
          fontSize={appearance.fontSize}
          onFontSizeChange={(size) => setAppearance((current) => ({ ...current, fontSize: size }))}
          fontFamily={appearance.fontFamily}
          onFontFamilyChange={(fontFamily) => setAppearance((current) => ({ ...current, fontFamily }))}
          language={appearance.language}
          onLanguageChange={(language) => setAppearance((current) => ({ ...current, language }))}
          onClose={() => setSettingsTab(undefined)}
        />
      )}

      <div className="toasts" aria-live="polite">
        {state.toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.level}`} role="status">
            <span>{toast.message}</span>
            <button type="button" className="toast__close" onClick={() => state.dismissToast(toast.id)} aria-label="关闭提示">
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
