/**
 * 存储设置：作品图片保存到哪个文件夹。
 *
 * 目录只能通过系统对话框选——renderer 不能直接写路径，
 * 这样"作品存到哪"永远由用户在操作系统层面确认过。
 */
import { useCallback, useEffect, useState } from "react";
import type { LibrarySettingsView } from "../../shared/library.ts";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function LibrarySettingsPanel() {
  const [view, setView] = useState<LibrarySettingsView>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(() => {
    setLoading(true);
    void window.appLibrary
      ?.view()
      .then((value) => setView(value))
      .catch(() => setView(undefined))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function chooseDir() {
    setNotice(undefined);
    const result = await window.appLibrary?.chooseDir();
    if (result?.ok) {
      setNotice(`已切换到：${result.dir}`);
      refresh();
    } else if (result?.error && result.error !== "已取消") {
      setNotice(`没能切换：${result.error}`);
    }
  }

  async function openDir() {
    const result = await window.appLibrary?.openDir();
    if (result && !result.ok) setNotice(`打开文件夹失败：${result.message}`);
  }

  if (loading && view === undefined) return <p className="field__hint">正在读取存储位置…</p>;
  if (view === undefined) return <p className="field__hint">主进程没有提供作品库信息。</p>;

  return (
    <section className="settings__section" aria-label="存储设置">
      <h3>作品保存位置</h3>
      <p className="field__hint">
        生成的图片会写到这个文件夹，作品记录会随应用保存，重启后仍在作品库里。
        索引文件放在应用数据目录，所以换文件夹不会让已有作品消失。
      </p>

      <div className="path-box">
        <code className="path-box__path">{view.resolvedDir}</code>
        <div className="path-box__actions">
          <button type="button" className="button button--ghost" onClick={() => void chooseDir()}>
            选择文件夹…
          </button>
          <button type="button" className="button button--ghost" onClick={() => void openDir()}>
            打开文件夹
          </button>
        </div>
      </div>

      <p className="field__hint">
        默认位置：<code>{view.defaultDir}</code>
      </p>

      <dl className="facts">
        <div className="fact">
          <dt>作品</dt>
          <dd>
            {view.stats.assets} 张 · 约 {formatBytes(view.stats.bytes)}
          </dd>
        </div>
        <div className="fact">
          <dt>任务记录</dt>
          <dd>{view.stats.jobs} 条</dd>
        </div>
      </dl>

      {view.lastLoadWarning && <p className="settings__notice settings__notice--error">{view.lastLoadWarning}</p>}
      {notice && <p className="settings__notice settings__notice--info">{notice}</p>}

      <p className="field__hint">
        图片文件在 <code>assets</code> 子目录里，文件名带时间戳；直接删除文件后，下次启动会自动把它们从作品库移除。
      </p>
    </section>
  );
}
