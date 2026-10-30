/**
 * 数据管理：导出 / 导入 / 清除。
 *
 * 三块都用同一组复选框（配置、任务与图片），危险操作要二次确认。
 * 导入/清除成功后通知外层重新拉一次 bootstrap，界面不会停留在旧数据。
 */
import { useCallback, useEffect, useState } from "react";
import type { DataSelection, DataSummary } from "../../shared/data-management.ts";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function SelectionBoxes({
  value,
  onChange,
  disabled,
}: {
  readonly value: DataSelection;
  readonly onChange: (next: DataSelection) => void;
  readonly disabled: boolean;
}) {
  return (
    <div className="data-selection">
      <label className="switch">
        <input
          type="checkbox"
          checked={value.settings}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, settings: event.target.checked })}
        />
        <span>包含配置（服务商与密钥）</span>
      </label>
      <label className="switch">
        <input
          type="checkbox"
          checked={value.library}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, library: event.target.checked })}
        />
        <span>包含任务和图片</span>
      </label>
    </div>
  );
}

export function DataSettingsPanel() {
  const [summary, setSummary] = useState<DataSummary>();
  const [exportSel, setExportSel] = useState<DataSelection>({ settings: true, library: true });
  const [importSel, setImportSel] = useState<DataSelection>({ settings: true, library: true });
  const [clearSel, setClearSel] = useState<DataSelection>({ settings: false, library: true });
  const [busy, setBusy] = useState<"export" | "import" | "clear">();
  const [notice, setNotice] = useState<{ readonly kind: "ok" | "error" | "info"; readonly text: string }>();
  const [confirmClear, setConfirmClear] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [needPassphrase, setNeedPassphrase] = useState(false);

  const refresh = useCallback(() => {
    void window.appData
      ?.summary()
      .then((value) => setSummary(value))
      .catch(() => setSummary(undefined));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const nothingPicked = (selection: DataSelection) => !selection.settings && !selection.library;

  async function run(kind: "export" | "import") {
    const selection = kind === "export" ? exportSel : importSel;
    if (nothingPicked(selection)) {
      setNotice({ kind: "error", text: "至少勾选一项" });
      return;
    }
    setBusy(kind);
    setNotice({ kind: "info", text: kind === "export" ? "正在导出…" : "正在导入…" });
    const payload = { ...selection, ...(passphrase.trim() === "" ? {} : { passphrase: passphrase.trim() }) };
    const result = kind === "export" ? await window.appData?.export(payload) : await window.appData?.import(payload);
    setBusy(undefined);
    if (result?.ok) {
      setNeedPassphrase(false);
      setNotice({ kind: "ok", text: result.message });
      refresh();
      if (kind === "import") window.dispatchEvent(new Event("image-agent:data-changed"));
    } else if (result?.needsPassphrase === true) {
      setNeedPassphrase(true);
      setNotice({ kind: "error", text: result.error });
    } else {
      setNotice({ kind: "error", text: result?.error ?? "操作失败" });
    }
  }

  async function runClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      setNotice({ kind: "info", text: "再点一次「确认清除」——这个操作不可撤销。" });
      return;
    }
    if (nothingPicked(clearSel)) {
      setNotice({ kind: "error", text: "至少勾选一项" });
      return;
    }
    setBusy("clear");
    const result = await window.appData?.clear(clearSel);
    setBusy(undefined);
    setConfirmClear(false);
    if (result?.ok) {
      setNotice({ kind: "ok", text: result.message });
      refresh();
      window.dispatchEvent(new Event("image-agent:data-changed"));
    } else {
      setNotice({ kind: "error", text: result?.error ?? "清除失败" });
    }
  }

  return (
    <section className="settings__section" aria-label="数据管理">
      <h3>当前数据</h3>
      <dl className="facts">
        <div className="fact">
          <dt>服务商配置</dt>
          <dd>{summary === undefined ? "—" : `${summary.profiles} 个`}</dd>
        </div>
        <div className="fact">
          <dt>任务 / 图片</dt>
          <dd>
            {summary === undefined ? "—" : `${summary.jobs} 条 / ${summary.assets} 张 · ${formatBytes(summary.libraryBytes)}`}
          </dd>
        </div>
        <div className="fact fact--mono">
          <dt>图片目录</dt>
          <dd>{summary?.libraryDir ?? "—"}</dd>
        </div>
      </dl>

      <h3>导出数据</h3>
      <p className="field__hint">打包成一个 ZIP，包含所选内容。配置里含 API Key，请妥善保管这个文件。</p>
      <SelectionBoxes value={exportSel} onChange={setExportSel} disabled={busy !== undefined} />
      <label className="field">
        <span className="field__label">
          口令加密
          <span className="field__meta">可选</span>
        </span>
        <input
          className="field__input"
          type="password"
          value={passphrase}
          placeholder="留空则不加密"
          aria-label="备份口令"
          onChange={(event) => setPassphrase(event.target.value)}
        />
        <span className="field__hint">
          填了口令会把整个备份用 AES-256-GCM 加密（导出的文件是 <code>.iaz</code>），
          导入时必须输入同一口令；不填就是普通 ZIP，里面的 API Key 是明文。
        </span>
      </label>
      {needPassphrase && (
        <p className="field__hint field__hint--warn">
          这个备份已加密。在上面的「口令加密」里输入口令，再点一次「导入…」即可（不用重新选文件）。
        </p>
      )}
      <div className="settings__footer">
        <button
          type="button"
          className="button button--primary"
          disabled={busy !== undefined || nothingPicked(exportSel)}
          onClick={() => void run("export")}
        >
          {busy === "export" ? "导出中…" : "导出为 ZIP…"}
        </button>
      </div>

      <h3>导入数据</h3>
      <p className="field__hint">从本应用导出的 ZIP 恢复。只会恢复「已勾选且备份里有」的部分，同名作品与配置会被覆盖。</p>
      <SelectionBoxes value={importSel} onChange={setImportSel} disabled={busy !== undefined} />
      <div className="settings__footer">
        <button
          type="button"
          className="button button--ghost"
          disabled={busy !== undefined || nothingPicked(importSel)}
          onClick={() => void run("import")}
        >
          {busy === "import" ? "导入中…" : "从 ZIP 导入…"}
        </button>
      </div>

      <h3>清除数据</h3>
      <p className="field__hint">删除所选数据，不可撤销。清除「任务和图片」会同时删掉图片目录里的文件。</p>
      <SelectionBoxes value={clearSel} onChange={setClearSel} disabled={busy !== undefined} />
      <div className="settings__footer">
        <button
          type="button"
          className="button button--danger"
          disabled={busy !== undefined || nothingPicked(clearSel)}
          onClick={() => void runClear()}
        >
          {busy === "clear" ? "清除中…" : confirmClear ? "确认清除" : "清除所选数据"}
        </button>
        {confirmClear && (
          <button type="button" className="button button--ghost" onClick={() => setConfirmClear(false)}>
            取消
          </button>
        )}
      </div>

      {notice && <p className={`settings__notice settings__notice--${notice.kind}`}>{notice.text}</p>}
    </section>
  );
}
