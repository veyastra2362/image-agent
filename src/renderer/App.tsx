/**
 * 创作页主布局：窄导航 + 参数栏 + 结果画布 + 详情抽屉。
 *
 * 没有 Agent 时也能直接生成、查看作品——这是 S5 的验收项，S1 先把最小可用链路跑通。
 */
import { useEffect, useState } from "react";
import { Composer } from "./image/Composer.tsx";
import { DetailsDrawer } from "./image/DetailsDrawer.tsx";
import { JobList } from "./image/JobList.tsx";
import { ResultCanvas } from "./image/ResultCanvas.tsx";
import { useImageAgent } from "./image/use-image-agent.ts";

export function App() {
  const state = useImageAgent();
  const [focusPrompt, setFocusPrompt] = useState(0);

  // N（不在输入框中时）把焦点送回提示词，方便连续创作。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (!typing && !event.ctrlKey && !event.metaKey && (event.key === "n" || event.key === "N")) {
        setFocusPrompt((value) => value + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="shell">
      <nav className="rail" aria-label="主导航">
        <span className="rail__mark" aria-hidden="true">
          IA
        </span>
        <ul>
          <li>
            <button type="button" className="rail__item rail__item--active" aria-current="page">
              <span aria-hidden="true">✎</span>
              <span className="rail__label">创作</span>
            </button>
          </li>
          <li>
            <button type="button" className="rail__item" disabled title="作品库在 S5 完成">
              <span aria-hidden="true">▦</span>
              <span className="rail__label">作品库</span>
            </button>
          </li>
          <li>
            <button type="button" className="rail__item" disabled title="服务商设置在 S2 完成">
              <span aria-hidden="true">⚙</span>
              <span className="rail__label">服务商</span>
            </button>
          </li>
        </ul>
        <p className="rail__foot">S1</p>
      </nav>

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

      {state.selectedAssetId && <DetailsDrawer state={state} onClose={state.closeDrawer} />}

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
