/**
 * API 设置面板：多个服务商并存，可切换、新建、删除。
 *
 * 密钥规则：输入框是受控的本地草稿，永远不回填已保存的密钥（main 也不回传）。
 * 输入框留空 = 不改密钥；有内容才会随"保存"一起提交。
 */
import { useEffect, useMemo, useState } from "react";

import {
  API_FLAVOR_LABELS,
  API_TIMEOUT_RANGE,
  FAL_QUEUE_NOTE,
  MAX_MODELS,
  MAX_PROFILES,
  PARTIAL_IMAGE_RANGE,
  PROVIDER_KIND_LABELS,
  PROVIDER_KINDS,
  effectivePartialImages,
  supportsPartialImages,
  validateProviderProfile,
  type ApiFlavor,
  type ProviderKind,
  type ProviderProfile,
  type ProviderSettingsView,
  type UpstreamModel,
} from "../../shared/provider-settings.ts";

type Busy = "idle" | "testing" | "fetching" | "saving" | "creating" | "removing";

export interface ApiSettingsPanelProps {
  readonly view: ProviderSettingsView | undefined;
  readonly loading: boolean;
  readonly onRefresh: () => void;
}

export function ApiSettingsPanel({ view, loading, onRefresh }: ApiSettingsPanelProps) {
  const [draft, setDraft] = useState<ProviderProfile | undefined>();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [notice, setNotice] = useState<{ readonly kind: "ok" | "error" | "info"; readonly text: string }>();
  const [discovered, setDiscovered] = useState<readonly UpstreamModel[] | undefined>();
  const [newModelId, setNewModelId] = useState("");

  // 外部刷新或切换服务商后把草稿对齐到落盘值。
  useEffect(() => {
    if (view === undefined) return;
    const active = view.profiles.find((profile) => profile.id === view.activeId) ?? view.profiles[0];
    setDraft(active === undefined ? undefined : { ...active });
    setApiKey("");
    setDiscovered(undefined);
  }, [view]);

  const keyStatus = draft === undefined ? undefined : view?.keys[draft.id];
  const dirty = useMemo(() => {
    if (draft === undefined || view === undefined) return false;
    const saved = view.profiles.find((profile) => profile.id === draft.id);
    return JSON.stringify(saved) !== JSON.stringify(draft) || apiKey.trim() !== "";
  }, [draft, view, apiKey]);

  if (loading && view === undefined) return <p className="field__hint">正在读取配置…</p>;
  if (view === undefined || draft === undefined) {
    return (
      <div className="settings__section">
        <p className="field__hint">读不到配置文件。</p>
        <button type="button" className="button button--ghost" onClick={onRefresh}>
          重新读取
        </button>
      </div>
    );
  }

  const patch = (changes: Partial<ProviderProfile>) => setDraft((current) => (current ? { ...current, ...changes } : current));
  const keyLocked = keyStatus?.apiKeyFromEnv === true;
  const partialDisabled = !(draft.stream && supportsPartialImages(draft.flavor));
  const keyForRequest = apiKey.trim() === "" ? undefined : apiKey.trim();
  const validation = validateProviderProfile(draft);
  const preview = effectivePartialImages(draft);

  async function switchTo(id: string) {
    if (id === view?.activeId) return;
    await window.appSettings?.activate(id);
    onRefresh();
  }

  async function handleCreate() {
    setBusy("creating");
    const created = await window.appSettings?.create();
    setBusy("idle");
    if (created?.ok) {
      setNotice({ kind: "ok", text: "已新建一个服务商配置，填好后点保存。" });
      onRefresh();
    } else {
      setNotice({ kind: "error", text: created?.message ?? "新建失败" });
    }
  }

  async function handleRemove() {
    if (draft === undefined) return;
    setBusy("removing");
    const removed = await window.appSettings?.remove(draft.id);
    setBusy("idle");
    if (removed?.ok) {
      setNotice({ kind: "ok", text: `已删除「${draft.label}」。` });
      onRefresh();
    } else {
      setNotice({ kind: "error", text: removed?.message ?? "删除失败" });
    }
  }

  async function handleSave() {
    if (draft === undefined) return;
    setBusy("saving");
    const result = await window.appSettings?.save({
      profile: draft,
      ...(keyForRequest === undefined ? {} : { apiKey: keyForRequest }),
    });
    setBusy("idle");
    if (result?.ok) {
      setApiKey("");
      setNotice({ kind: "ok", text: "已保存，创作页的模型列表已更新。" });
      onRefresh();
    } else {
      setNotice({ kind: "error", text: result?.message ?? "保存失败" });
    }
  }

  async function handleTest() {
    setBusy("testing");
    setNotice({ kind: "info", text: "正在测试连通性…" });
    const result = await window.appSettings?.test({
      id: draft?.id,
      settings: draft,
      ...(keyForRequest === undefined ? {} : { apiKey: keyForRequest }),
    });
    setBusy("idle");
    if (result?.ok) {
      setDiscovered(result.models);
      setNotice({ kind: "ok", text: result.message });
    } else {
      setNotice({ kind: "error", text: result?.error ?? "测试失败" });
    }
  }

  async function handleFetchModels() {
    setBusy("fetching");
    setNotice({ kind: "info", text: "正在从上游获取模型列表…" });
    const result = await window.appSettings?.fetchModels({
      id: draft?.id,
      settings: draft,
      ...(keyForRequest === undefined ? {} : { apiKey: keyForRequest }),
    });
    setBusy("idle");
    if (result?.ok) {
      setDiscovered(result.models);
      setNotice({ kind: "ok", text: `上游返回 ${result.models.length} 个模型，勾选后加入下方列表。` });
    } else {
      setNotice({ kind: "error", text: result?.error ?? "获取失败" });
    }
  }

  function toggleModel(id: string, checked: boolean) {
    if (draft === undefined) return;
    const models = checked
      ? draft.models.includes(id)
        ? draft.models
        : [...draft.models, id]
      : draft.models.filter((entry) => entry !== id);
    const defaultModel =
      draft.defaultModel !== undefined && models.includes(draft.defaultModel) ? draft.defaultModel : models[0];
    patch({ models: models.slice(0, MAX_MODELS), ...(defaultModel === undefined ? {} : { defaultModel }) });
  }

  function addManualModel() {
    const id = newModelId.trim();
    if (id === "" || draft === undefined) return;
    if (draft.models.includes(id)) {
      setNotice({ kind: "error", text: `「${id}」已经在列表里了` });
      return;
    }
    toggleModel(id, true);
    setNewModelId("");
  }

  return (
    <section className="settings__section" aria-label="API 设置">
      <div className="settings__row">
        <h3>服务商</h3>
        <span className={`badge ${view.enabledCount > 0 ? "badge--ok" : "badge--muted"}`}>
          已启用 {view.enabledCount} 个
        </span>
      </div>

      <div className="profile-tabs" role="tablist" aria-label="服务商配置">
        {view.profiles.map((profile) => {
          const status = view.keys[profile.id];
          return (
            <button
              key={profile.id}
              type="button"
              role="tab"
              aria-selected={profile.id === draft.id}
              className={`profile-tab ${profile.id === draft.id ? "is-active" : ""}`}
              onClick={() => void switchTo(profile.id)}
            >
              <span className="profile-tab__label">{profile.label}</span>
              <span className={`profile-tab__dot ${status?.hasApiKey ? "is-on" : ""}`} aria-hidden="true" />
            </button>
          );
        })}
        <button
          type="button"
          className="profile-tab profile-tab--add"
          onClick={() => void handleCreate()}
          disabled={busy !== "idle" || view.profiles.length >= MAX_PROFILES}
          title={view.profiles.length >= MAX_PROFILES ? `最多 ${MAX_PROFILES} 个` : "新建服务商"}
        >
          ＋
        </button>
      </div>

      <div className="settings__inline">
        <label className="field" style={{ flex: 1 }}>
          <span className="field__label">名称</span>
          <input
            className="field__input"
            value={draft.label}
            maxLength={40}
            onChange={(event) => patch({ label: event.target.value })}
          />
        </label>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy !== "idle" || view.profiles.length <= 1}
          onClick={() => void handleRemove()}
          title={view.profiles.length <= 1 ? "至少要保留一个配置" : "删除这个配置"}
        >
          删除
        </button>
      </div>

      <label className="field">
        <span className="field__label">服务商类型</span>
        <select
          className="field__input"
          value={draft.kind}
          onChange={(event) => patch({ kind: event.target.value as ProviderKind })}
        >
          {PROVIDER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {PROVIDER_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        {draft.kind === "fal" && <span className="field__hint">{FAL_QUEUE_NOTE}</span>}
      </label>

      <label className="field">
        <span className="field__label">API URL</span>
        <input
          className="field__input"
          value={draft.baseUrl}
          placeholder={draft.kind === "fal" ? "https://queue.fal.run" : "https://api.example.com/v1"}
          onChange={(event) => patch({ baseUrl: event.target.value })}
        />
      </label>

      <label className="field">
        <span className="field__label">
          API Key
          {keyLocked && <span className="field__meta">来自 .env / 环境变量</span>}
          {!keyLocked && keyStatus?.apiKeyEncrypted && <span className="field__meta">已加密保存</span>}
        </span>
        <input
          className="field__input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={keyLocked}
          value={apiKey}
          placeholder={
            keyLocked ? "由 .env 提供，界面不能修改" : keyStatus?.hasApiKey ? "已保存（留空表示不修改）" : "粘贴密钥"
          }
          onChange={(event) => setApiKey(event.target.value)}
        />
        <span className="field__hint">
          {keyLocked
            ? "这个地址的密钥来自 .env 或环境变量，优先级高于界面配置；要修改请改文件后重启。"
            : keyStatus?.apiKeyEncrypted
              ? "密钥由系统钥匙串加密后保存在本机，不回传界面、不写入页面存储。"
              : "密钥只保存在本机 main 进程的配置文件里，不回传界面、不写入页面存储。"}
        </span>
      </label>

      <div className="field">
        <span className="field__label">API 接口</span>
        <div className="chips" role="radiogroup" aria-label="API 接口">
          {(Object.keys(API_FLAVOR_LABELS) as ApiFlavor[]).map((flavor) => (
            <button
              key={flavor}
              type="button"
              role="radio"
              aria-checked={draft.flavor === flavor}
              className={`chip ${draft.flavor === flavor ? "is-active" : ""}`}
              onClick={() => patch({ flavor })}
            >
              {API_FLAVOR_LABELS[flavor]}
            </button>
          ))}
        </div>
      </div>

      <div className="settings__row">
        <h3>模型</h3>
        <div className="settings__row-actions">
          <button type="button" className="button button--ghost" disabled={busy !== "idle"} onClick={() => void handleTest()}>
            {busy === "testing" ? "测试中…" : "测试连通性"}
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={busy !== "idle"}
            onClick={() => void handleFetchModels()}
          >
            {busy === "fetching" ? "获取中…" : "获取上游模型"}
          </button>
        </div>
      </div>

      {discovered !== undefined && (
        <div className="model-picker" aria-label="上游模型">
          <p className="field__hint">勾选要启用到界面上的模型（共 {discovered.length} 个）：</p>
          <div className="model-picker__list">
            {discovered.map((model) => (
              <label key={model.id} className="model-picker__item">
                <input
                  type="checkbox"
                  checked={draft.models.includes(model.id)}
                  onChange={(event) => toggleModel(model.id, event.target.checked)}
                />
                <span className="model-picker__id">{model.id}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {draft.models.length > 0 ? (
        <ul className="chosen-models">
          {draft.models.map((id) => (
            <li key={id} className="chosen-models__item">
              <span className="model-picker__id">{id}</span>
              <button
                type="button"
                className={`chip ${draft.defaultModel === id ? "is-active" : ""}`}
                onClick={() => patch({ defaultModel: id })}
                title="设为默认模型"
              >
                {draft.defaultModel === id ? "默认" : "设为默认"}
              </button>
              <button type="button" className="modal__close" aria-label={`移除 ${id}`} onClick={() => toggleModel(id, false)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field__hint">还没有启用任何模型；保存后这个服务商不会出现在创作页。</p>
      )}

      <div className="settings__inline">
        <input
          className="field__input"
          value={newModelId}
          placeholder="手动填写模型 ID，例如 gpt-image-2"
          onChange={(event) => setNewModelId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addManualModel();
            }
          }}
        />
        <button type="button" className="button button--ghost" onClick={addManualModel}>
          添加
        </button>
      </div>

      <h3>流式传输</h3>
      <label className="switch">
        <input type="checkbox" checked={draft.stream} onChange={(event) => patch({ stream: event.target.checked })} />
        <span>开启流式传输</span>
      </label>
      <p className="field__hint">
        并非所有服务商和网关都支持。官方接口在流式模式下不发送心跳，需要配合中间步骤图像维持连接，
        避免超时断开。官方接口仅支持单图流式生成，因此数量大于 1 时会拆成多个单图请求并发执行。
      </p>
      {draft.stream && draft.flavor === "images" && (
        <p className="field__hint field__hint--warn">
          Images API 没有流式端点，当前组合下流式不会真正生效；要用流式请把 API 接口切到 Responses API。
        </p>
      )}

      <div className="field">
        <span className="field__label">
          中间步骤图像数
          {partialDisabled && <span className="field__meta">仅在流式 + Responses 时生效</span>}
        </span>
        <div className="chips" role="radiogroup" aria-label="中间步骤图像数">
          {[0, 1, 2, 3].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={draft.partialImages === value}
              disabled={partialDisabled}
              className={`chip ${draft.partialImages === value ? "is-active" : ""}`}
              onClick={() => patch({ partialImages: value })}
            >
              {value} 张
            </button>
          ))}
        </div>
        <span className="field__hint">
          对应 partial_images 参数（{PARTIAL_IMAGE_RANGE.min}–{PARTIAL_IMAGE_RANGE.max}）。建议设为 2 或 3，
          避免长时间生成时连接超时断开；实际返回的每张中间图像会产生少量额外计费。
          设为 0 时不请求中间步骤图像，连接可能因无数据传输而被断开。
          {preview !== draft.partialImages && ` 当前实际发送：${preview}。`}
        </span>
      </div>

      <label className="field">
        <span className="field__label">请求超时（秒）</span>
        <input
          className="field__input"
          type="number"
          min={API_TIMEOUT_RANGE.min}
          max={API_TIMEOUT_RANGE.max}
          step={10}
          value={draft.timeoutSeconds}
          onChange={(event) => patch({ timeoutSeconds: Number(event.target.value) })}
        />
        <span className="field__hint">
          {API_TIMEOUT_RANGE.min}–{API_TIMEOUT_RANGE.max} 秒。官方接口出图通常在 20 秒以上，建议不低于 120。
        </span>
      </label>

      {notice && (
        <p className={`settings__notice settings__notice--${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}
      {!validation.ok && <p className="field__hint field__hint--warn">还差一步：{validation.error}</p>}

      <div className="settings__footer">
        <button
          type="button"
          className="button button--primary"
          disabled={busy !== "idle" || !validation.ok || !dirty}
          onClick={() => void handleSave()}
        >
          {busy === "saving" ? "保存中…" : dirty ? "保存" : "没有改动"}
        </button>
        <button type="button" className="button button--ghost" onClick={onRefresh}>
          重新读取
        </button>
      </div>
    </section>
  );
}
