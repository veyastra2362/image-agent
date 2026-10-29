/**
 * 服务商设置：校验、持久化、上游探测。全部离线。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PROVIDER_SETTINGS,
  effectivePartialImages,
  supportsPartialImages,
  validateProviderSettings,
  type ProviderSettings,
} from "../shared/provider-settings";
import { ProviderSettingsStore } from "../main/provider-settings-store";
import { describeHttpFailure, describeNetworkFailure, fetchUpstreamModels, parseModelsPayload } from "../main/upstream-probe";

const valid: ProviderSettings = {
  kind: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  flavor: "images",
  models: ["gpt-image-2"],
  stream: false,
  partialImages: 2,
  timeoutSeconds: 180,
};

function memoryStore() {
  const files = new Map<string, string>();
  const store = new ProviderSettingsStore({
    dir: "C:\\fake\\userData",
    readFile: (file) => {
      const data = files.get(file);
      if (data === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return data;
    },
    writeFile: (file, data) => void files.set(file, data),
  });
  return { store, files };
}

test("校验：合法设置原样通过", () => {
  const result = validateProviderSettings(valid);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, valid);
});

test("校验：地址、模型 ID、部分镜像数、超时", () => {
  assert.equal(validateProviderSettings({ ...valid, baseUrl: "ftp://x" }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, baseUrl: "https://user:pw@x.com" }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, baseUrl: "" }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, kind: "azure" }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, flavor: "chat" }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, models: ["has space"] }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, models: ["a", "a"] }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, models: Array.from({ length: 33 }, (_, i) => `m${i}`) }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, defaultModel: "not-in-list" }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, partialImages: 4 }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, partialImages: -1 }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, partialImages: 1.5 }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, timeoutSeconds: 5 }).ok, false);
  assert.equal(validateProviderSettings({ ...valid, timeoutSeconds: 601 }).ok, false);
  assert.equal(validateProviderSettings(null).ok, false);
});

test("末端斜杠被去掉，模型 ID 允许常见分隔符", () => {
  const result = validateProviderSettings({ ...valid, baseUrl: "https://x.com/v1///", models: ["fal-ai/flux/dev", "gpt-image-2.5-flare"] });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.baseUrl, "https://x.com/v1");
});

test("partial_images 只在 流式 + Responses 时生效", () => {
  assert.equal(supportsPartialImages("responses"), true);
  assert.equal(supportsPartialImages("images"), false);
  assert.equal(effectivePartialImages({ ...valid, stream: true, flavor: "responses", partialImages: 3 }), 3);
  assert.equal(effectivePartialImages({ ...valid, stream: false, flavor: "responses", partialImages: 3 }), 0);
  assert.equal(effectivePartialImages({ ...valid, stream: true, flavor: "images", partialImages: 3 }), 0);
});

test("持久化：保存后能读回，密钥不回显在 view 里", () => {
  const { store } = memoryStore();
  store.load();
  assert.deepEqual(store.settings, DEFAULT_PROVIDER_SETTINGS);
  assert.equal(store.view(false).hasApiKey, false);

  store.saveSettings(valid);
  store.setApiKey("sk-secret-1");

  const reopened = new ProviderSettingsStore({
    dir: "C:\\fake\\userData",
    readFile: () => JSON.stringify({ version: 1, settings: valid, apiKey: "sk-secret-1" }),
  });
  reopened.load();
  assert.deepEqual(reopened.settings, valid);
  assert.equal(reopened.view(false).hasApiKey, true);
  assert.equal(reopened.view(false).apiKeyFromEnv, false);
  assert.equal(reopened.view(true).apiKeyFromEnv, true);
  assert.equal(JSON.stringify(reopened.view(false)).includes("sk-secret-1"), false, "view 不能带密钥");
  assert.equal(reopened.keyFingerprint()?.length, 12);
});

test("持久化：损坏或越界的文件退回默认值而不是崩溃", () => {
  for (const raw of ["not json", "{}", JSON.stringify({ settings: { ...valid, partialImages: 9 } })]) {
    const store = new ProviderSettingsStore({ dir: "C:\\fake", readFile: () => raw });
    store.load();
    assert.deepEqual(store.settings, DEFAULT_PROVIDER_SETTINGS, raw);
  }
});

test("持久化：明文里只有用户选择的设置与密钥，不写其他东西", () => {
  const { store, files } = memoryStore();
  store.saveSettings(valid);
  store.setApiKey("sk-secret-2");
  const written = [...files.values()].join("\n");
  assert.ok(written.includes("sk-secret-2"));
  assert.ok(written.includes("https://api.example.com/v1"));
  assert.equal(written.includes("password"), false);
});

test("模型列表解析容忍多种上游形状", () => {
  assert.deepEqual(parseModelsPayload({ data: [{ id: "b" }, { id: "a" }] }).map((m) => m.id), ["a", "b"]);
  assert.deepEqual(parseModelsPayload({ models: [{ name: "x", display_name: "X" }] }), [{ id: "x", displayName: "X" }]);
  assert.deepEqual(parseModelsPayload(["z", "z", "y"]).map((m) => m.id), ["y", "z"]);
  assert.deepEqual(parseModelsPayload({ nope: 1 }), []);
  assert.deepEqual(parseModelsPayload(null), []);
});

test("拉模型列表：成功、401、404、超时", async () => {
  const okFetch = (async () =>
    new Response(JSON.stringify({ data: [{ id: "gpt-image-2" }] }), { status: 200 })) as unknown as typeof fetch;
  const ok = await fetchUpstreamModels({ kind: "openai-compatible", baseUrl: "https://x.com/v1", apiKey: "k", fetchImpl: okFetch });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.models, [{ id: "gpt-image-2" }]);

  const unauthorized = (async () =>
    new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 })) as unknown as typeof fetch;
  const bad = await fetchUpstreamModels({ kind: "openai-compatible", baseUrl: "https://x.com/v1", apiKey: "sk-live-abcdef", fetchImpl: unauthorized });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.match(bad.error, /HTTP 401/);
    assert.match(bad.error, /Incorrect API key/);
    assert.equal(bad.error.includes("sk-live-abcdef"), false, "错误里不能回显密钥");
  }

  const slow = (async (_input: unknown, init?: RequestInit) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;
  const timedOut = await fetchUpstreamModels({
    kind: "openai-compatible",
    baseUrl: "https://x.com/v1",
    apiKey: "k",
    timeoutMs: 30,
    fetchImpl: slow,
  });
  assert.equal(timedOut.ok, false);
  if (!timedOut.ok) assert.match(timedOut.error, /超时/);
});

test("fal.ai 不提供模型列表端点，明确说明而不是硬编一个地址", async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch;
  const result = await fetchUpstreamModels({ kind: "fal", baseUrl: "https://queue.fal.run", apiKey: "k", fetchImpl: spy });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /手动填写/);
  assert.equal(called, false);
});

test("错误文案：状态码带提示，网络错误说人话", () => {
  assert.match(describeHttpFailure(404, ""), /地址或路径不对/);
  assert.match(describeHttpFailure(429, "slow down"), /限流/);
  assert.match(describeNetworkFailure(Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } })), /域名解析失败/);
  const aborted = new AbortController();
  aborted.abort();
  assert.match(describeNetworkFailure(new Error("x"), aborted.signal), /超时/);
});
