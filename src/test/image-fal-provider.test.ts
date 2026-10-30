/**
 * fal.ai 适配器：队列式提交 → 轮询状态 → 下载结果（全部用 stub fetch）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { FalProvider } from "../main/image-generation/providers/fal";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function makeProvider(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const provider = new FalProvider({
    baseUrl: "https://queue.fal.run",
    apiKey: "fal-key",
    models: ["fal-ai/flux/dev"],
    pollAfterMs: 10,
    fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(handler(url, init ?? {}));
    }) as unknown as typeof fetch,
  });
  return { provider, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("提交：URL 带 app id，Authorization 用 Key，参数放进 input", async () => {
  const { provider, calls } = makeProvider(() => json({ request_id: "req-1" }));
  const result = await provider.submit(
    {
      model: "fal-ai/flux/dev",
      prompt: "a cat",
      referenceAssetIds: [],
      aspectRatio: "16:9",
      count: 1,
      seed: 42,
      negativePrompt: "text",
    },
    new AbortController().signal,
  );

  assert.equal(result.state, "running");
  if (result.state !== "running") return;
  assert.equal(result.remoteTaskId, "req-1");
  assert.equal(calls[0]?.url, "https://queue.fal.run/fal-ai/flux/dev");
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Key fal-key");
  const body = JSON.parse(String(calls[0]?.init.body)) as { input: Record<string, unknown> };
  assert.equal(body.input.prompt, "a cat");
  assert.equal(body.input.image_size, "landscape_16_9");
  assert.equal(body.input.seed, 42);
  assert.equal(body.input.negative_prompt, "text");
});

test("轮询：IN_QUEUE 继续等，COMPLETED 后拉结果并下载图片", async () => {
  let polls = 0;
  const { provider, calls } = makeProvider((url) => {
    if (url.endsWith("/status")) {
      polls += 1;
      return json({ status: polls === 1 ? "IN_QUEUE" : "COMPLETED" });
    }
    if (url.endsWith("/requests/req-1")) {
      return json({ images: [{ url: "https://cdn.fal.run/a.png" }] });
    }
    return new Response(PNG_BYTES, { headers: { "content-type": "image/png" } });
  });

  const first = await provider.poll("req-1", new AbortController().signal);
  assert.equal(first.state, "running");

  const second = await provider.poll("req-1", new AbortController().signal);
  assert.equal(second.state, "completed");
  if (second.state !== "completed") return;
  assert.equal(second.images.length, 1);
  assert.equal(second.images[0]?.mimeType, "image/png");
  assert.equal(second.images[0]?.bytes.length, PNG_BYTES.length);
  assert.ok(calls.some((call) => call.url === "https://cdn.fal.run/a.png"));
});

test("轮询：非耗时状态（如 ERROR）判失败", async () => {
  const { provider } = makeProvider(() => json({ status: "ERROR" }));
  const result = await provider.poll("req-1", new AbortController().signal);
  assert.equal(result.state, "failed");
});

test("取消：PUT 到 /cancel，404 时返回 false", async () => {
  const { provider, calls } = makeProvider(() => new Response("", { status: 404 }));
  assert.equal(await provider.cancel("req-1"), false);
  assert.equal(calls[0]?.url, "https://queue.fal.run/fal-ai/flux/dev/requests/req-1/cancel");
  assert.equal(calls[0]?.init.method, "PUT");
});

test("HTTP 错误：401 映射成 provider-unavailable 且不可重试", async () => {
  const { provider } = makeProvider(() => json({ detail: "bad key" }, 401));
  const error: unknown = await provider
    .submit(
      { model: "fal-ai/flux/dev", prompt: "x", referenceAssetIds: [], aspectRatio: "1:1", count: 1 },
      new AbortController().signal,
    )
    .catch((thrown: unknown) => thrown);
  const detail = (error as { detail?: { code?: string; retryable?: boolean } }).detail;
  assert.equal(detail?.code, "provider-unavailable");
  assert.equal(detail?.retryable, false);
});

test("能力声明：异步 + 可取消", () => {
  const { provider } = makeProvider(() => json({}));
  const caps = provider.getCapabilities("fal-ai/flux/dev");
  assert.equal(caps?.async, true);
  assert.equal(caps?.cancel, true);
  assert.equal(caps?.seed, true);
});
