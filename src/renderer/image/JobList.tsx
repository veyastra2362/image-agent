/**
 * 全局任务栏：多任务排队、成功/失败、详情入口。
 * 切换页面或继续创作时任务状态始终可见。
 */
import type { ImageTaskEvent } from "../../shared/image-generation.ts";
import { formatTime } from "../lib/format.ts";
import { describeStatus } from "../lib/job-status.ts";
import { useEffect, useRef, useState } from "react";
import { cancellable, type ImageAgentState } from "./use-image-agent.ts";

interface JobListProps {
  readonly state: ImageAgentState;
  readonly onOpenAsset: (assetId: string) => void;
}

export function JobList({ state, onOpenAsset }: JobListProps) {
  const [menu, setMenu] = useState<{ readonly event: ImageTaskEvent; readonly x: number; readonly y: number }>();

  return (
    <section className="joblist" aria-labelledby="joblist-title">
      <header className="joblist__head">
        <h2 id="joblist-title">任务</h2>
        <span className="joblist__count">{state.jobs.length}</span>
      </header>
      {state.jobs.length === 0 ? (
        <p className="joblist__empty">提交后会在这里看到进度。</p>
      ) : (
        <ul>
          {state.jobs.map((entry) => (
            <JobRow
              key={entry.job.id}
              event={entry}
              onOpen={() => {
                const assetId = entry.assets[0]?.id;
                if (assetId) onOpenAsset(assetId);
              }}
              onCancel={() => void state.cancel(entry.job.id)}
              onContextMenu={(position) => setMenu({ event: entry, x: position.x, y: position.y })}
            />
          ))}
        </ul>
      )}

      {menu !== undefined && (
        <RowContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            {
              label: "打开",
              onPick: () => {
                const assetId = menu.event.assets[0]?.id;
                if (assetId !== undefined) onOpenAsset(assetId);
              },
            },
            { label: "移除", tone: "danger", onPick: () => state.hideJob(menu.event.job.id) },
          ]}
        />
      )}
    </section>
  );
}

/** 任务行的右键菜单：跟着鼠标定位，点外面/Esc 关闭。 */
function RowContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  readonly x: number;
  readonly y: number;
  readonly items: readonly { readonly label: string; readonly tone?: "danger"; readonly onPick: () => void }[];
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: x, top: y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`ctx-menu__item ${item.tone === "danger" ? "ctx-menu__item--danger" : ""}`}
          onClick={() => {
            item.onPick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function JobRow({
  event,
  onOpen,
  onCancel,
  onContextMenu,
}: {
  readonly event: ImageTaskEvent;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
  readonly onContextMenu: (position: { readonly x: number; readonly y: number }) => void;
}) {
  const presentation = describeStatus(event.job.status);
  const first = event.assets[0];
  return (
    <li
      className="job-row"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(input) => {
        if (input.key !== "Enter" && input.key !== " ") return;
        input.preventDefault();
        onOpen();
      }}
      onContextMenu={(input) => {
        input.preventDefault();
        onContextMenu({ x: input.clientX, y: input.clientY });
      }}
    >
      {first ? (
        <span className="job-row__thumb">
          <img src={first.previewUrl} alt="" loading="lazy" />
        </span>
      ) : (
        <span className={`job-row__thumb job-row__thumb--empty status--${presentation.tone}`} aria-hidden="true">
          {presentation.glyph}
        </span>
      )}
      <div className="job-row__main">
        <p className="job-row__prompt">{event.job.submittedPrompt}</p>
        <p className="job-row__meta">
          <span className={`status status--${presentation.tone}`}>{presentation.label}</span>
          <span>
            {event.job.modelDisplayName} · {formatTime(event.job.updatedAt)}
          </span>
        </p>
        {event.job.error && <p className="job-row__error">{event.job.error.message}</p>}
      </div>
      {cancellable(event) && (
        <button
          type="button"
          className="button button--tiny"
          onClick={(input) => {
            input.stopPropagation();
            onCancel();
          }}
          aria-label="停止此任务"
        >
          停止
        </button>
      )}
    </li>
  );
}
