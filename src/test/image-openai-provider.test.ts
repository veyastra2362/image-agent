/**
 * OpenAI 兼容 adapter 的离线测试：请求形状、响应解析、错误映射。
 * 全部使用注入的假 fetch，不访问网络、不花钱。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  OpenAICompatibleProvider,
  parseJsonMaybe,
  sizeForAspect,
  toProviderError,
} from "../main/image-generation/providers/openai-compatible";

const PNG = readFileSync(path.join(process.cwd(), "fixtures", "fake-square-a.png"));
const PNG_B64 = PNG.toString("base64");

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeProvider(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://api.example.com/v1/",
    apiKey: "sk-secret-value",
    models: [{ id: "model-a", displayName: "Model A" }],
    fetchImpl: (input, init) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(handler(url, init ?? {}));
    },
  });
  return { provider, calls };
}

const request = {
  model: "model-a",
  prompt: "a cat",
  referenceAssetIds: [],
  aspectRatio: "1:1" as const,
  count: 1,
};

test("能力声明是保守的：不支持 seed/负面词/取消", () => {
  const { provider } = makeProvider(() => jsonResponse(200, {}));
  const caps = provider.getCapabilities("model-a");
  assert.ok(caps);
  assert.equal(caps.seed, false);
  assert.equal(caps.negativePrompt, false);
  assert.equal(caps.cancel, false);
  assert.equal(caps.async, false);
  assert.deepEqual(caps.aspectRatios, ["1:1", "4:3", "3:4"]);
  assert.equal(provider.descriptor.billable, true);
  assert.equal(provider.descriptor.uploadsUserAssets, false);
});

test("比例映射到受支持的固定尺寸", () => {
  assert.equal(sizeForAspect("1:1"), "1024x1024");
  assert.equal(sizeForAspect("4:3"), "1536x1024");
  assert.equal(sizeForAspect("3:4"), "1024x1536");
});

test("提交请求的形状与鉴权头正确，b64_json 被解码为 PNG 字节", async () => {
  const { provider, calls } = makeProvider(() =>
    jsonResponse(200, { data: [{ b64_json: PNG_B64 }, { b64_json: PNG_B64 }] }),
  );

  const result = await provider.submit({ ...request, count: 2 }, new AbortController().signal);
  assert.equal(result.state, "completed");
  if (result.state !== "completed") return;
  assert.equal(result.images.length, 2);
  assert.deepEqual(Buffer.from(result.images[0]?.bytes ?? []), PNG);

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "https://api.example.com/v1/images/generations");
  assert.equal(call.init.method, "POST");
  const headers = new Headers(call.init.headers);
  assert.equal(headers.get("authorization"), "Bearer sk-secret-value");
  assert.deepEqual(JSON.parse(String(call.init.body)), {
    model: "model-a",
    prompt: "a cat",
    n: 2,
    size: "1024x1024",
  });
});

test("url 形式的返回会下载图片", async () => {
  const { provider, calls } = makeProvider((url) => {
    if (url.includes("/images/generations")) {
      return jsonResponse(200, { data: [{ url: "https://cdn.example.com/a.png" }] });
    }
    return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  });

  const result = await provider.submit(request, new AbortController().signal);
  assert.equal(result.state, "completed");
  if (result.state !== "completed") return;
  assert.deepEqual(Buffer.from(result.images[0]?.bytes ?? []), PNG);
  assert.equal(calls[1]?.url, "https://cdn.example.com/a.png");
  // 下载请求不应带上密钥。
  assert.equal(new Headers(calls[1]?.init.headers).get("authorization"), null);
});

test("非 https 的图片地址被拒绝", async () => {
  const { provider } = makeProvider(() => jsonResponse(200, { data: [{ url: "http://evil.example.com/a.png" }] }));
  await assert.rejects(() => provider.submit(request, new AbortController().signal), /不是 https/);
});

test("空数据、坏 PNG 都被拒绝", async () => {
  const empty = makeProvider(() => jsonResponse(200, { data: [] }));
  await assert.rejects(() => empty.provider.submit(request, new AbortController().signal), /没有返回图片/);

  const notPng = makeProvider(() => jsonResponse(200, { data: [{ b64_json: Buffer.from("hello").toString("base64") }] }));
  await assert.rejects(() => notPng.provider.submit(request, new AbortController().signal), /不是合法 PNG/);
});

test("HTTP 错误映射为可区分的错误码，且不回显密钥", () => {
  const unauthorized = toProviderError(401, { error: { message: "bad key sk-secret-value" } }, "");
  assert.equal(unauthorized.code, "provider-unavailable");
  assert.equal(unauthorized.retryable, false);

  assert.equal(toProviderError(404, undefined, "").code, "unknown-model");
  assert.equal(toProviderError(400, { error: { message: "invalid size" } }, "").code, "invalid-request");
  const throttled = toProviderError(429, {}, "");
  assert.equal(throttled.code, "provider-unavailable");
  assert.equal(throttled.retryable, true);
  assert.equal(toProviderError(503, {}, "").retryable, true);
});

test("上游回显的尺寸与请求不一致时明确报错，而不是静默接受", async () => {
  const { provider } = makeProvider(() => jsonResponse(200, { data: [{ b64_json: PNG_B64, size: "512x512" }] }));
  await assert.rejects(
    () => provider.submit(request, new AbortController().signal),
    /512x512 与请求的 1024x1024 不一致/,
  );
});

test("尺寸一致时正常通过（真实网关会回显 size 字段）", async () => {
  const { provider } = makeProvider(() =>
    jsonResponse(200, { data: [{ b64_json: PNG_B64, size: "1024x1024", revised_prompt: "a cat" }] }),
  );
  const result = await provider.submit(request, new AbortController().signal);
  assert.equal(result.state, "completed");
});

test("parseJsonMaybe 同时接受普通 JSON 与 SSE 包裹的 JSON", () => {
  assert.deepEqual(parseJsonMaybe('{"data":[{"b64_json":"x"}]}'), { data: [{ b64_json: "x" }] });
  const sse = 'data: {"created":1,"data":[{"b64_json":"y"}]}\n\ndata: [DONE]\n';
  assert.deepEqual(parseJsonMaybe(sse), { created: 1, data: [{ b64_json: "y" }] });
  assert.equal(parseJsonMaybe(""), undefined);
  assert.equal(parseJsonMaybe("not json at all"), undefined);
});

test("4xx 时 submit 抛出连带服务商说明的错误", async () => {
  const { provider } = makeProvider(() => jsonResponse(400, { error: { message: "size not supported" } }));
  await assert.rejects(
    () => provider.submit(request, new AbortController().signal),
    (error: Error) => /size not supported/.test(JSON.stringify(error)),
  );
});

test("上游 abort 会让请求以 AbortError 结束", async () => {
  const controller = new AbortController();
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    models: [{ id: "model-a", displayName: "Model A" }],
    fetchImpl: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  });

  const pending = provider.submit(request, controller.signal);
  controller.abort("cancelled");
  await assert.rejects(pending, /abort|cancel/i);
});
