/**
 * Anthropic 适配器：只做语言模型（改写 / 规划），请求头与回复结构与 OpenAI 不同。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { AnthropicProvider } from "../main/image-generation/providers/anthropic";

function makeProvider(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const provider = new AnthropicProvider({
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "sk-ant-test",
    models: ["claude-sonnet-4"],
    fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(handler(String(input), init ?? {}));
    }) as unknown as typeof fetch,
  });
  return { provider, calls };
}

const anthropicOk = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("optimizePrompt：走 /messages，带 x-api-key 与 anthropic-version", async () => {
  const { provider, calls } = makeProvider(() => anthropicOk("一只橘猫"));

  const result = await provider.optimizePrompt("一只猫", "claude-sonnet-4", new AbortController().signal);
  assert.equal(result, "一只橘猫");

  assert.equal(calls[0]?.url, "https://api.anthropic.com/v1/messages");
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], "sk-ant-test");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers.authorization, undefined, "Anthropic 不用 Bearer");

  const body = JSON.parse(String(calls[0]?.init.body)) as {
    model: string;
    max_tokens: number;
    system: string;
    messages: { role: string; content: string }[];
  };
  assert.equal(body.model, "claude-sonnet-4");
  assert.ok(body.max_tokens > 0);
  assert.match(body.system, /提示词/);
  assert.deepEqual(body.messages, [{ role: "user", content: "一只猫" }]);
});

test("planImage：要求 JSON 的系统提示", async () => {
  const { provider, calls } = makeProvider(() => anthropicOk('{"prompt":"x"}'));
  const raw = await provider.planImage("做个封面", "claude-sonnet-4", new AbortController().signal);
  assert.equal(raw, '{"prompt":"x"}');
  const body = JSON.parse(String(calls[0]?.init.body)) as { system: string };
  assert.match(body.system, /JSON/);
});

test("多个 content 块会拼起来；空内容报错", async () => {
  const ok = makeProvider(
    () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  assert.equal(
    await ok.provider.optimizePrompt("x", "claude-sonnet-4", new AbortController().signal),
    "ab",
  );

  const empty = makeProvider(() => new Response(JSON.stringify({ content: [] }), { status: 200 }));
  await assert.rejects(
    () => empty.provider.optimizePrompt("x", "claude-sonnet-4", new AbortController().signal),
    /没有返回文本/,
  );
});

test("401 映射成 provider-unavailable，且不能用来出图", async () => {
  const { provider } = makeProvider(() => new Response('{"error":"bad key"}', { status: 401 }));
  const error: unknown = await provider
    .optimizePrompt("x", "claude-sonnet-4", new AbortController().signal)
    .catch((thrown: unknown) => thrown);
  assert.equal((error as { detail?: { code?: string } }).detail?.code, "provider-unavailable");
  assert.throws(() => provider.submit(), /不支持出图/);
});
