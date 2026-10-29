/**
 * 应用外壳：自绘标题栏（拖拽区 + 设置 + 窗口按钮）、左侧导航、三个页面。
 *
 * 系统菜单已被去掉（Menu.setApplicationMenu(null)），标题栏与操作栏合成这一行：
 * 左边是应用名和导航，右边是设置与最小化/最大化/关闭。
 */
import { useCallback, useEffect, useState } from "react";
import type { AppEnvironment } from "../shared/app-shell.ts";
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from "./lib/appearance.ts";
import { Composer } from "./image/Composer.tsx";
import { DetailsDrawer } from "./image/DetailsDrawer.tsx";
import { JobList } from "./image/JobList.tsx";
import { LibraryView, ProviderView } from "./image/LibraryView.tsx";
import { ResultCanvas } from "./image/ResultCanvas.tsx";
import { useImageAgent } from "./image/use-image-agent.ts";
import { SettingsDialog, type SettingsTab } from "./settings/SettingsDialog.tsx";

type View = "create" | "library" | "providers";

const VIEWS: readonly { readonly id: View; readonly label: string; readonly glyph: string }[] = [
  { id: "create", label: "创作", glyph: "✎" },
  { id: "library", label: "作品库", glyph: "▦" },
  { id: "providers", label: "服务商", glyph: "⚙" },
];

export function App() {
  const state = useImageAgent();
  const [view, setView] = useState<View>("create");
  const [focusPrompt, setFocusPrompt] = useState(0);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>();
  const [environment, setEnvironment] = useState<AppEnvironment>();
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    applyAppearance(appearance);
    saveAppearance(appearance);
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

  const toggleMaximize = useCallback(async () => {
    const next = await window.appWindow?.toggleMaximize();
    setMaximized(next === true);
  }, []);

  const handleDoubleClick = useCallback(() => {
    void toggleMaximize();
  }, [toggleMaximize]);

  return (
    <div className="app">
      <header className="titlebar" onDoubleClick={handleDoubleClick}>
        <div className="titlebar__lead">
          <span className="titlebar__mark" aria-hidden="true">
            IA
          </span>
          <span className="titlebar__name">Image Agent</span>
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
              <span aria-hidden="true">{entry.glyph}</span>
              <span>{entry.label}</span>
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
            ⚙
          </button>
          <span className="titlebar__divider" aria-hidden="true" />
          <button
            type="button"
            className="window-btn"
            aria-label="最小化"
            title="最小化"
            onClick={() => void window.appWindow?.minimize()}
          >
            ─
          </button>
          <button
            type="button"
            className="window-btn"
            aria-label={maximized ? "还原" : "最大化"}
            title={maximized ? "还原" : "最大化"}
            onClick={() => void toggleMaximize()}
          >
            {maximized ? "❐" : "□"}
          </button>
          <button
            type="button"
            className="window-btn window-btn--close"
            aria-label="关闭"
            title="关闭"
            onClick={() => void window.appWindow?.close()}
          >
            ✕
          </button>
        </div>
      </header>

      {view === "create" && (
        <div className="shell">
          <aside className="panel" aria-label="创作参数">
            <Composer
              focusPromptToken={focusPrompt}
              state={state}
              models={state.models}
              onSubmitted={() => undefined}
              onOpenLastResult={() => state.latestAssetId && state.openAsset(state.latestAssetId)}
            />
            <JobList state={state} onOpenAsset={state.openAsset} />
          </aside>

          <main className="workspace">
            <ResultCanvas state={state} onOpenAsset={state.openAsset} />
          </main>
        </div>
      )}

      {view === "library" && (
        <main className="workspace workspace--page">
          <LibraryView state={state} onOpenAsset={state.openAsset} />
        </main>
      )}

      {view === "providers" && (
        <main className="workspace workspace--page">
          <ProviderView models={state.models} state={state} />
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
          onClose={() => setSettingsTab(undefined)}
        />
      )}

      <div className="toasts" aria-live="polite">
        {state.toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.level}`} role="status">
            <span>{toast.message}</span>
            <button
              type="button"
              className="toast__close"
              onClick={() => state.dismissToast(toast.id)}
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
