/**
 * SSE 解析 + Responses 适配器（离线 fixture，不打真实接口）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ResponsesProvider } from "../main/image-generation/providers/responses";
import { isDoneSentinel, parseSse, SseParser } from "../main/image-generation/sse";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function sseResponse(chunks: readonly string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

function makeProvider(handler: (url: string, init: RequestInit) => Response, partialImages = 2) {
  const calls: { url: string; init: RequestInit }[] = [];
  const provider = new ResponsesProvider({
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-secret",
    models: [{ id: "gpt-image-2", displayName: "GPT Image 2" }],
    partialImages,
    fetchImpl: (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(handler(String(input), init ?? {}));
    },
  });
  return { provider, calls };
}

test("SSE：多行 data、event 名、跨块拼行、[DONE]", () => {
  const parser = new SseParser();
  const first = parser.push('event: response.output\ndata: {"a":');
  assert.equal(first.length, 0, "半行不该产出事件");

  const second = parser.push('1}\n\ndata: [DONE]\n\n');
  assert.equal(second.length, 2);
  assert.equal(second[0]?.event, "response.output");
  assert.equal(second[0]?.data, '{"a":1}');
  assert.equal(isDoneSentinel(second[1]!), true);

  const multi = parseSse("event: x\ndata: line1\ndata: line2\n\n");
  assert.equal(multi[0]?.data, "line1\nline2");
});

test("SSE：忽略注释行与 CRLF", () => {
  const events = parseSse(": keep-alive\r\nevent: ping\r\ndata: {}\r\n\r\n");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "ping");
});

test("Responses：请求体带 stream/tools/partial_images，返回最终图", async () => {
  const { provider, calls } = makeProvider(() =>
    sseResponse([
      'event: response.created\ndata: {"type":"response.created"}\n\n',
      `event: response.image_generation_call.partial_image\ndata: {"partial_image_b64":"${PNG_BASE64}"}\n\n`,
      `event: response.completed\ndata: {"output":[{"type":"image_generation_call","result":"${PNG_BASE64}"}]}\n\n`,
      "data: [DONE]\n\n",
    ]),
  );

  const partials: number[] = [];
  const result = await provider.submit(
    {
      model: "gpt-image-2",
      prompt: "a cat",
      referenceAssetIds: [],
      aspectRatio: "1:1",
      count: 1,
      size: { width: 1024, height: 1024 },
      onPartialImage: ({ index }) => partials.push(index),
    },
    new AbortController().signal,
  );

  assert.equal(result.state, "completed");
  if (result.state !== "completed") return;
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0]?.mimeType, "image/png");

  const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
  assert.equal(body.stream, true);
  assert.deepEqual(body.modalities, ["image"]);
  const tool = (body.tools as Record<string, unknown>[])[0];
  assert.equal(tool?.type, "image_generation");
  assert.equal(tool?.partial_images, 2);
  assert.equal(tool?.size, "1024x1024");
  assert.deepEqual(partials, [1], "中间图只报一次进度，且不当作最终图");

  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.match(headers.authorization ?? "", /^Bearer sk-/);
});

test("Responses：上游返回 error 事件时抛出可读错误", async () => {
  const { provider } = makeProvider(() =>
    sseResponse(['event: error\ndata: {"error":{"message":"boom"}}\n\n']),
  );
  await assert.rejects(
    () =>
      provider.submit(
        { model: "gpt-image-2", prompt: "x", referenceAssetIds: [], aspectRatio: "1:1", count: 1 },
        new AbortController().signal,
      ),
    /boom/,
  );
});

test("Responses：没有任何图片就报错，而不是静默成功", async () => {
  const { provider } = makeProvider(() => sseResponse(['event: response.completed\ndata: {"output":[]}\n\n']));
  await assert.rejects(
    () =>
      provider.submit(
        { model: "gpt-image-2", prompt: "x", referenceAssetIds: [], aspectRatio: "1:1", count: 1 },
        new AbortController().signal,
      ),
    /没有返回图片/,
  );
});

test("Responses：HTTP 401 映射成 provider-unavailable", async () => {
  const { provider } = makeProvider(() => new Response('{"error":{"message":"bad key"}}', { status: 401 }));
  const error: unknown = await provider
    .submit(
      { model: "gpt-image-2", prompt: "x", referenceAssetIds: [], aspectRatio: "1:1", count: 1 },
      new AbortController().signal,
    )
    .catch((thrown: unknown) => thrown);
  const detail = (error as { detail?: { code?: string } }).detail;
  assert.equal(detail?.code, "provider-unavailable");
});

test("Responses：能力声明没有轮询/取消，支持任意尺寸", () => {
  const { provider } = makeProvider(() => sseResponse([]));
  const caps = provider.getCapabilities("gpt-image-2");
  assert.equal(caps?.async, false);
  assert.equal(caps?.cancel, false);
  assert.equal(caps?.autoSize, true);
  assert.equal(caps?.customSize, true);
  assert.ok((caps?.aspectRatios.length ?? 0) >= 8);
});
