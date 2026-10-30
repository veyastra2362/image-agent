/**
 * API 设置面板：多个服务商配置，每个有自己的地址、密钥与模型。
 *
 * 交互约定：
 *  - 提示是临时浮层，几秒后自动消失，不占版面
 *  - "保存"在弹窗底部（关闭按钮旁边），由外层通过 onFooterChange 渲染
 *  - 获取上游模型后弹二级弹窗勾选，而不是在表单里堆一长列
 *  - 手动添加模型先只显示按钮，点了才出现输入框；已添加的模型可以直接改
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "../shell/Select.tsx";
import { ChevronIcon, TrashIcon } from "../shell/icons.tsx";
import type { ImageCapabilities } from "../../shared/image-generation.ts";

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
  normalizeDefaultModel,
  supportsPartialImages,
  validateProviderProfile,
  type ApiFlavor,
  type ProviderKind,
  type ProviderProfile,
  type ProviderPurpose,
  type ProviderSettingsView,
  type UpstreamModel,
} from "../../shared/provider-settings.ts";

type Busy = "idle" | "testing" | "fetching" | "saving" | "creating" | "removing";

export interface FooterAction {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

export interface ApiSettingsPanelProps {
  readonly view: ProviderSettingsView | undefined;
  readonly loading: boolean;
  readonly onRefresh: () => void;
  /** 把"保存"按钮交给弹窗底部渲染。 */
  readonly onFooterChange: (action: FooterAction | undefined) => void;
}

export function ApiSettingsPanel({ view, loading, onRefresh, onFooterChange }: ApiSettingsPanelProps) {
  const [draft, setDraft] = useState<ProviderProfile | undefined>();
  const [apiKey, setApiKey] = useState("");
  const [purpose, setPurpose] = useState<ProviderPurpose>("image");
  const [busy, setBusy] = useState<Busy>("idle");
  const [notice, setNotice] = useState<{ readonly kind: "ok" | "error" | "info"; readonly text: string }>();
  const [pickerModels, setPickerModels] = useState<readonly UpstreamModel[]>();
  const [pickerChecked, setPickerChecked] = useState<readonly string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [capsByModel, setCapsByModel] = useState<Record<string, ImageCapabilities>>({});
  const [expandedModel, setExpandedModel] = useState<number>();
  const [newModelId, setNewModelId] = useState("");

  // 提示自动消失：操作结果看一眼就够，不该长期占着版面。
  const flash = useCallback((kind: "ok" | "error" | "info", text: string) => {
    setNotice({ kind, text });
  }, []);
  useEffect(() => {
    if (notice === undefined) return;
    const timer = setTimeout(() => setNotice(undefined), notice.kind === "error" ? 7000 : 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  // 模型的能力由 provider 声明；这里只是把它读出来展示，不在界面上猜测。
  useEffect(() => {
    void window.imageAgent
      ?.getBootstrap()
      .then((bootstrap) => {
        const map: Record<string, ImageCapabilities> = {};
        for (const ref of bootstrap.providers) map[`${ref.id}:${ref.model}`] = ref.capabilities;
        setCapsByModel(map);
      })
      .catch(() => undefined);
  }, [view]);

  // 外部刷新或切换服务商后把草稿对齐到落盘值。
  useEffect(() => {
    if (view === undefined) return;
    const samePurpose = view.profiles.filter((profile) => (profile.purpose ?? "image") === purpose);
    const active = samePurpose.find((profile) => profile.id === view.activeId) ?? samePurpose[0];
    setDraft(active === undefined ? undefined : { ...active });
    setApiKey("");
    setAddOpen(false);
  }, [view, purpose]);

  const keyStatus = draft === undefined ? undefined : view?.keys[draft.id];
  const dirty = useMemo(() => {
    if (draft === undefined || view === undefined) return false;
    const saved = view.profiles.find((profile) => profile.id === draft.id);
    return JSON.stringify(saved) !== JSON.stringify(draft) || apiKey.trim() !== "";
  }, [draft, view, apiKey]);

  const patch = useCallback((changes: Partial<ProviderProfile>) => {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }, []);

  const validation = useMemo(() => (draft === undefined ? undefined : validateProviderProfile(draft)), [draft]);
  const keyForRequest = apiKey.trim() === "" ? undefined : apiKey.trim();

  const handleSave = useCallback(async () => {
    if (draft === undefined) return;
    setBusy("saving");
    const result = await window.appSettings?.save({
      profile: draft,
      ...(keyForRequest === undefined ? {} : { apiKey: keyForRequest }),
    });
    setBusy("idle");
    if (result?.ok) {
      setApiKey("");
      flash("ok", "已保存，创作页的模型列表已更新。");
      onRefresh();
      // 主界面（侧栏/底部）的模型列表要跟着刷新，否则删了模型还能选到。
      window.dispatchEvent(new Event("image-agent:data-changed"));
    } else {
      flash("error", result?.message ?? "保存失败");
    }
  }, [draft, keyForRequest, flash, onRefresh]);

  // 把保存按钮注册到弹窗底部；依赖变化时重新注册，保证按钮状态是最新的。
  useEffect(() => {
    if (draft === undefined || validation === undefined) {
      onFooterChange(undefined);
      return;
    }
    onFooterChange({
      label: busy === "saving" ? "保存中…" : "保存",
      disabled: busy !== "idle" || !validation.ok || !dirty,
      onClick: () => void handleSave(),
    });
  }, [draft, validation, busy, dirty, handleSave, onFooterChange]);

  useEffect(() => () => onFooterChange(undefined), [onFooterChange]);

  if (loading && view === undefined) return <p className="field__hint">正在读取配置…</p>;
  // 只有读不到配置才显示错误；某一类还没建过配置时应该显示"空状态 + 新建"，不是报错。
  if (view === undefined) {
    return (
      <div className="settings__section">
        <p className="field__hint">读不到配置文件。</p>
        <button type="button" className="button button--ghost" onClick={onRefresh}>
          重新读取
        </button>
      </div>
    );
  }

  const partialDisabled = !(draft?.stream === true && supportsPartialImages(draft.flavor));
  const preview = draft === undefined ? 0 : effectivePartialImages(draft);

  async function switchTo(id: string) {
    if (id === view?.activeId) return;
    await window.appSettings?.activate(id);
    onRefresh();
  }

  async function handleCreate() {
    setBusy("creating");
    const created = await window.appSettings?.create({ purpose });
    setBusy("idle");
    if (created?.ok) {
      // 立刻把草稿切到新配置：不依赖 view 刷新的时序，否则编辑区会一片空白。
      setDraft({ ...created.profile });
      setApiKey("");
      flash("ok", `已新建「${created.profile.label}」，填好后点保存。`);
      onRefresh();
      window.dispatchEvent(new Event("image-agent:data-changed"));
    } else {
      flash("error", created?.message ?? "新建失败");
    }
  }

  async function removeProfile(profile: { readonly id: string; readonly label: string }) {
    setBusy("removing");
    const removed = await window.appSettings?.remove(profile.id);
    setBusy("idle");
    if (removed?.ok) {
      flash("ok", `已删除「${profile.label}」。`);
      onRefresh();
      window.dispatchEvent(new Event("image-agent:data-changed"));
    } else {
      flash("error", removed?.message ?? "删除失败");
    }
  }

  async function handleTest() {
    setBusy("testing");
    flash("info", "正在测试连通性…");
    const result = await window.appSettings?.test({
      id: draft?.id,
      settings: draft,
      ...(keyForRequest === undefined ? {} : { apiKey: keyForRequest }),
    });
    setBusy("idle");
    if (result?.ok) flash("ok", result.message);
    else flash("error", result?.error ?? "测试失败");
  }

  async function handleFetchModels() {
    setBusy("fetching");
    flash("info", "正在从上游获取模型列表…");
    const result = await window.appSettings?.fetchModels({
      id: draft?.id,
      settings: draft,
      ...(keyForRequest === undefined ? {} : { apiKey: keyForRequest }),
    });
    setBusy("idle");
    if (result?.ok) {
      setPickerModels(result.models);
      setPickerChecked(result.models.filter((model) => draft?.models.includes(model.id)).map((model) => model.id));
      setNotice(undefined);
    } else {
      flash("error", result?.error ?? "获取失败");
    }
  }

  function applyPicker() {
    const picked = pickerChecked;
    const upstream = pickerModels ?? [];
    setDraft((current) => {
      if (!current) return current;
      const upstreamIds = new Set(upstream.map((model) => model.id));
      // 只动"来自上游列表"的那些：手动加的模型不受影响。
      const kept = current.models.filter((id) => !upstreamIds.has(id) || picked.includes(id));
      const models = [...kept, ...picked.filter((id) => !kept.includes(id))].slice(0, MAX_MODELS);
      return { ...current, models, defaultModel: normalizeDefaultModel(models, current.defaultModel) };
    });
    setPickerModels(undefined);
  }

  function setModelAt(index: number, value: string) {
    setDraft((current) => {
      if (!current) return current;
      const models = current.models.map((id, i) => (i === index ? value : id));
      return { ...current, models, defaultModel: normalizeDefaultModel(models, current.defaultModel) };
    });
  }

  function removeModelAt(index: number) {
    setDraft((current) => {
      if (!current) return current;
      const models = current.models.filter((_, i) => i !== index);
      return { ...current, models, defaultModel: normalizeDefaultModel(models, current.defaultModel) };
    });
  }

  /** 手动添加那条：单独一个保存按钮，把输入框里的 id 加入列表。 */
  function commitManualModel() {
    const id = newModelId.trim();
    if (id === "" || draft === undefined) return;
    if (draft.models.includes(id)) {
      flash("error", `「${id}」已经在列表里了`);
      return;
    }
    setDraft((current) => {
      if (!current) return current;
      const models = [...current.models, id].slice(0, MAX_MODELS);
      return { ...current, models, defaultModel: normalizeDefaultModel(models, current.defaultModel) };
    });
    setNewModelId("");
    setAddOpen(false);
    flash("ok", `已加入「${id}」，别忘了保存。`);
  }

  return (
    <section className="settings__section" aria-label="API 设置">
      {notice && (
        <div className={`settings__toast settings__toast--${notice.kind}`} role="status">
          {notice.text}
        </div>
      )}

      <div className="settings__row">
        <h3>服务商</h3>
        <span className={`badge ${view.enabledCount > 0 ? "badge--ok" : "badge--muted"}`}>
          已启用 {view.enabledCount} 个
        </span>
      </div>

      {keyStatus?.keyUnreadable === true && (
        <p className="settings__notice settings__notice--error">
          已保存的 API Key 无法解密（通常是因为换了系统账户或机器）。请在下方重新填写一次。
        </p>
      )}

      {view.enabledCount === 0 && (
        <p className="settings__notice settings__notice--info">
          还没有可用的真实服务。连接信息现在只由这里管理（应用不再读取 .env 或环境变量），
          填好 API URL 与 Key、勾选模型后保存即可立即生效。
        </p>
      )}

      <div className="purpose-switch" role="tablist" aria-label="接口用途">
        <span
          className="purpose-switch__thumb"
          aria-hidden="true"
          style={{ transform: purpose === "text" ? "translateX(calc(100% + 4px))" : "none" }}
        />
        {(["image", "text"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={purpose === entry}
            className={`purpose-switch__item ${purpose === entry ? "is-active" : ""}`}
            onClick={() => setPurpose(entry)}
          >
            {entry === "image" ? "图片模型" : "语言模型"}
          </button>
        ))}
      </div>

      <div className="profile-tabs" role="tablist" aria-label="服务商配置">
        {view.profiles.filter((profile) => (profile.purpose ?? "image") === purpose).map((profile) => (
          <div
            key={profile.id}
            className={`profile-tab ${profile.id === draft?.id ? "is-active" : ""}`}
            role="tab"
            aria-selected={profile.id === draft?.id}
          >
            <button type="button" className="profile-tab__select" onClick={() => void switchTo(profile.id)}>
              <span className="profile-tab__label">{profile.label}</span>
            </button>
            {/* 固定宽度的尾槽：绿点和垃圾桶占同一块位置，hover 时整颗药丸不会变宽。 */}
            <span className="profile-tab__suffix">
              <span className={`profile-tab__dot ${view.keys[profile.id]?.hasApiKey ? "is-on" : ""}`} aria-hidden="true" />
              <button
                type="button"
                className="profile-tab__delete"
                disabled={view.profiles.length <= 1 || busy !== "idle"}
                aria-label={`删除「${profile.label}」`}
                title={view.profiles.length <= 1 ? "至少要保留一个配置" : "删除这个配置"}
                onClick={() => void removeProfile(profile)}
              >
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path
                  d="M3 4.5h10M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M5 4.5l.6 8a1 1 0 0 0 1 .95h3.8a1 1 0 0 0 1-.95l.6-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              </button>
            </span>
          </div>
        ))}
        <button
          type="button"
          className="profile-tab profile-tab--add"
          onClick={() => void handleCreate()}
          disabled={busy !== "idle" || view.profiles.length >= MAX_PROFILES}
          title={view.profiles.length >= MAX_PROFILES ? `最多 ${MAX_PROFILES} 个` : "新建服务商"}
          aria-label="新建服务商"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {draft === undefined ? (
        <p className="field__hint">
          还没有配置{purpose === "text" ? "语言模型" : "图片服务商"}，点上面的「＋」新建一个。
        </p>
      ) : (
        <>
      <label className="field">
        <span className="field__label">名称</span>
        <input
          className="field__input"
          value={draft.label}
          maxLength={40}
          onChange={(event) => patch({ label: event.target.value })}
        />
      </label>

      <label className="field">
        <span className="field__label">服务商类型</span>
        <Select
          ariaLabel="服务商类型"
          value={draft.kind}
          onChange={(next) => patch({ kind: next as ProviderKind })}
          options={(draft.purpose === "text" ? (["openai-compatible"] as const) : PROVIDER_KINDS).map((kind) => ({
            value: kind,
            label: PROVIDER_KIND_LABELS[kind],
          }))}
        />
        {draft.kind === "fal" && <span className="field__hint">{FAL_QUEUE_NOTE}</span>}
      </label>

      <label className="field">
        <span className="field__label">API URL</span>
        <input
          className="field__input"
          aria-label="API URL"
          value={draft.baseUrl}
          placeholder={draft.kind === "fal" ? "https://queue.fal.run" : "https://api.example.com/v1"}
          onChange={(event) => patch({ baseUrl: event.target.value })}
        />
      </label>

      <label className="field">
        <span className="field__label">
          API Key
          {keyStatus?.apiKeyEncrypted && <span className="field__meta">已加密保存</span>}
        </span>
        <input
          className="field__input"
          type="password"
          aria-label="API Key"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={keyStatus?.hasApiKey ? "已保存（留空表示不修改）" : "粘贴密钥"}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <span className="field__hint">
          {keyStatus?.apiKeyEncrypted
            ? "密钥由系统钥匙串加密后保存在本机，不回传界面、不写入页面存储。"
            : "密钥随应用配置保存在本机，不回传界面、不写入页面存储。"}
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

      {draft.models.length > 0 ? (
        <ul className="chosen-models">
          {draft.models.map((id, index) => {
            const open = expandedModel === index;
            const caps = capsByModel[`${draft.id}:${id}`];
            return (
              <li key={`${id}-${index}`} className={`chosen-models__item ${open ? "is-open" : ""}`}>
                {/* 模型 ID 本身就是输入框：点进去就能改，不用先点"编辑"。 */}
                <input
                  className="chosen-models__input"
                  value={id}
                  aria-label={`模型 ${index + 1}`}
                  spellCheck={false}
                  onChange={(event) => setModelAt(index, event.target.value)}
                />
                <button
                  type="button"
                  className={`chip ${draft.defaultModel === id ? "is-active" : ""}`}
                  onClick={() => patch({ defaultModel: id })}
                  title="设为默认模型"
                >
                  {draft.defaultModel === id ? "默认" : "设为默认"}
                </button>
                <button
                  type="button"
                  className="chosen-models__detail-toggle"
                  aria-expanded={open}
                  aria-label={open ? "收起参数" : "查看参数"}
                  title="查看这个模型的参数"
                  onClick={() => setExpandedModel(open ? undefined : index)}
                >
                  <ChevronIcon open={open} />
                </button>
                <button
                  type="button"
                  className="chosen-models__remove"
                  aria-label={`移除 ${id}`}
                  title="移除"
                  onClick={() => removeModelAt(index)}
                >
                  <TrashIcon />
                </button>
                {open && (
                  <dl className="chosen-models__details">
                    <div>
                      <dt>能力</dt>
                      <dd>{describeCapabilities(caps)}</dd>
                    </div>
                    <div>
                      <dt>尺寸</dt>
                      <dd>{describeSizes(caps)}</dd>
                    </div>
                    <div>
                      <dt>输出格式</dt>
                      <dd>{caps === undefined ? "未知（未加载）" : caps.transcode ? "PNG / JPEG / WebP" : "仅 PNG"}</dd>
                    </div>
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="field__hint">还没有启用任何模型；保存后这个服务商不会出现在创作页。</p>
      )}

      {/* 手动添加：默认只有一个按钮，点了才出现输入框和它自己的保存按钮。 */}
      {addOpen ? (
        <div className="settings__inline">
          <input
            className="field__input"
            value={newModelId}
            autoFocus
            placeholder="模型 ID，例如 gpt-image-2"
            onChange={(event) => setNewModelId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitManualModel();
              }
            }}
          />
          <button type="button" className="button button--ghost" onClick={commitManualModel}>
            保存
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setAddOpen(false);
              setNewModelId("");
            }}
          >
            取消
          </button>
        </div>
      ) : (
        <div>
          <button type="button" className="button button--ghost" onClick={() => setAddOpen(true)}>
            添加模型
          </button>
        </div>
      )}

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

      <label className="field">
        <span className="field__label">Agent 模型（可选）</span>
        <input
          className="field__input"
          value={draft.agentModel ?? ""}
          placeholder="例如 gpt-4o-mini"
          onChange={(event) => patch({ agentModel: event.target.value })}
        />
        <span className="field__hint">
          用于「Agent 优化提示词」的 chat 模型，必须和图片接口在同一个服务商下。
          留空则该功能在创作页禁用；模型名不对时会提示上游不支持。
        </span>
      </label>

      {validation !== undefined && !validation.ok && (
        <p className="field__hint field__hint--warn">还差一步：{validation.error}</p>
      )}



        </>
      )}

      {/* 获取上游模型的结果：二级弹窗勾选 */}
      {pickerModels !== undefined && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setPickerModels(undefined)}
        >
          <div className="modal picker-modal" role="dialog" aria-modal="true" aria-label="选择上游模型">
            <header className="modal__head">
              <h2>选择上游模型</h2>
              <button type="button" className="modal__close" onClick={() => setPickerModels(undefined)} aria-label="关闭">
                ×
              </button>
            </header>
            <div className="modal__body">
              <p className="field__hint">共 {pickerModels.length} 个，勾选要启用到创作页的模型。</p>
              <div className="model-picker__list">
                {pickerModels.map((model) => (
                  <label key={model.id} className="model-picker__item">
                    <input
                      type="checkbox"
                      checked={pickerChecked.includes(model.id)}
                      onChange={(event) =>
                        setPickerChecked((current) =>
                          event.target.checked ? [...current, model.id] : current.filter((id) => id !== model.id),
                        )
                      }
                    />
                    <span className="model-picker__id">{model.id}</span>
                  </label>
                ))}
              </div>
            </div>
            <footer className="modal__foot">
              <button type="button" className="button button--ghost" onClick={() => setPickerModels(undefined)}>
                取消
              </button>
              <button type="button" className="button button--primary" onClick={applyPicker}>
                加入所选（{pickerChecked.length}）
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}

function describeCapabilities(caps: ImageCapabilities | undefined): string {
  if (caps === undefined) return "未知（未加载）";
  return [
    caps.textToImage ? "文生图" : "",
    caps.imageToImage
      ? Number.isFinite(caps.referenceImageLimit)
        ? `参考图（≤${caps.referenceImageLimit}）`
        : "参考图（不限）"
      : "不支持参考图",
    caps.seed ? "可固定 seed" : "无 seed",
    caps.negativePrompt ? "支持负面词" : "无负面词",
    caps.async ? "异步任务" : "同步返回",
    caps.cancel ? "可取消" : "不可取消",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 尺寸说明：这里显示的是 provider 适配器声明的能力，不是从上游猜的。
 * sizes 为空表示按比例自由推导；有值时只能发这几个固定尺寸。
 */
function describeSizes(caps: ImageCapabilities | undefined): string {
  if (caps === undefined) return "未知（未加载）";
  const parts: string[] = [];
  if (caps.autoSize) parts.push("支持自动尺寸");
  if (caps.customSize) parts.push("支持自定义宽高");
  if (caps.sizes.length > 0) parts.push(`固定尺寸 ${caps.sizes.join("、")}`);
  else if (caps.aspectRatios.length > 0) parts.push(`比例 ${caps.aspectRatios.join("、")}`);
  return parts.length === 0 ? "未声明" : parts.join(" · ");
}
