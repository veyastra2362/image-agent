/**
 * 真实适配器接到任务服务上的端到端测试：本机起一个假的 OpenAI 兼容服务，
 * 验证「renderer 请求 → main 校验 → adapter 发请求 → 结果落库」整条链路。
 * 不访问外网、不需要任何真实密钥。
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";

import type { ImageTaskEvent, Notification } from "../shared/image-generation";
import { ImageGenerationService } from "../main/image-generation/service";
import { OpenAICompatibleProvider } from "../main/image-generation/providers/openai-compatible";
import { MemoryJobStore } from "../main/image-generation/store";

const PNG = readFileSync(path.join(process.cwd(), "fixtures", "fake-square-b.png"));

interface SeenRequest {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

const seen: SeenRequest[] = [];
let server: Server;
let baseUrl = "";

function handle(request: IncomingMessage, response: ServerResponse): void {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    seen.push({
      url: request.url ?? "",
      authorization: request.headers.authorization,
      body: raw === "" ? undefined : JSON.parse(raw),
    });

    if (request.url === "/v1/images/generations") {
      const body = JSON.parse(raw) as { prompt?: string; n?: number };
      if (body.prompt === "触发限流") {
        response.writeHead(429, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "rate limited" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: Array.from({ length: body.n ?? 1 }, () => ({ b64_json: PNG.toString("base64") })) }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
}

before(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function createService() {
  const store = new MemoryJobStore();
  const events: ImageTaskEvent[] = [];
  const notifications: Notification[] = [];
  const service = new ImageGenerationService({
    providers: [
      new OpenAICompatibleProvider({
        baseUrl,
        apiKey: "sk-test-only",
        models: [{ id: "model-a", displayName: "Model A" }],
      }),
    ],
    store,
    emit: (event) => events.push(event),
    notify: (notification) => notifications.push(notification),
  });
  return { store, events, notifications, service };
}

async function waitForTerminal(service: ImageGenerationService, jobId: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = service.getBootstrap().jobs.find((entry) => entry.job.id === jobId)?.job;
    assert.ok(job);
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;
    if (Date.now() > deadline) throw new Error(`等待终态超时：${job.status}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("真实链路：提交 → 上游调用 → 图片落库 → succeeded", async () => {
  seen.length = 0;
  const { service, events, store } = createService();
  const created = await service.createJob({
    requestId: "req-openai-0001",
    providerId: "openai-images",
    model: "model-a",
    prompt: "a red fox in snow",
    count: 2,
    aspectRatio: "3:4",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const job = await waitForTerminal(service, created.event.job.id);
  assert.equal(job.status, "succeeded");
  assert.equal(job.assetIds.length, 2);

  for (const assetId of job.assetIds) assert.ok(store.getAsset(assetId));

  const call = seen.find((entry) => entry.url === "/v1/images/generations");
  assert.ok(call, "应当向 /images/generations 发过一次请求");
  assert.equal(call.authorization, "Bearer sk-test-only");
  // 3:4 + 1K 经 main 推导为 1024×1368（短边 1024，对齐 8），adapter 原样发给上游。
  assert.deepEqual(call.body, { model: "model-a", prompt: "a red fox in snow", n: 2, size: "1024x1368" });
  assert.equal(events.filter((event) => event.job.status === "succeeded").length, 1);
});

test("服务商限流时任务失败且提示可重试，不重试成重复计费", async () => {
  seen.length = 0;
  const { service, notifications } = createService();
  const created = await service.createJob({
    requestId: "req-openai-0002",
    providerId: "openai-images",
    model: "model-a",
    prompt: "触发限流",
    count: 1,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const job = await waitForTerminal(service, created.event.job.id);
  assert.equal(job.status, "failed");
  assert.match(job.error?.message ?? "", /429|限流/);
  assert.equal(job.error?.retryable, true);
  assert.equal(job.error?.code, "provider-unavailable");
  // 提交失败不自动重试：只应有一次上游请求。
  assert.equal(seen.filter((entry) => entry.url === "/v1/images/generations").length, 1);
  assert.ok(notifications.some((notification) => notification.level === "error"));
});

test("未知模型在 main 就被拒绝，不会打到上游", async () => {
  seen.length = 0;
  const { service } = createService();
  const result = await service.createJob({
    requestId: "req-openai-0003",
    providerId: "openai-images",
    model: "does-not-exist",
    prompt: "x",
    count: 1,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "unknown-model");
  assert.equal(seen.length, 0);
});

test("自定义宽高原样发给上游（实测上游不限尺寸）", async () => {
  seen.length = 0;
  const { service } = createService();
  const created = await service.createJob({
    requestId: "req-openai-0005",
    providerId: "openai-images",
    model: "model-a",
    prompt: "custom size test",
    count: 1,
    sizeMode: "custom",
    width: 1536,
    height: 640,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  const job = await waitForTerminal(service, created.event.job.id);
  assert.equal(job.status, "succeeded");
  const call = seen.find((entry) => entry.url === "/v1/images/generations");
  assert.ok(call, "应当发过请求");
  assert.equal(call.body.size, "1536x640");
});

test("自动尺寸不传 size 字段", async () => {
  seen.length = 0;
  const { service } = createService();
  const created = await service.createJob({
    requestId: "req-openai-0006",
    providerId: "openai-images",
    model: "model-a",
    prompt: "auto size test",
    count: 1,
    sizeMode: "auto",
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  const job = await waitForTerminal(service, created.event.job.id);
  assert.equal(job.status, "succeeded");
  const call = seen.find((entry) => entry.url === "/v1/images/generations");
  assert.ok(call);
  assert.equal("size" in call.body, false, "auto 时不应带 size");
});

test("不支持的参数（seed/负面词）在 main 被能力校验拦下", async () => {
  seen.length = 0;
  const { service } = createService();
  const result = await service.createJob({
    requestId: "req-openai-0004",
    providerId: "openai-images",
    model: "model-a",
    prompt: "x",
    count: 1,
    seed: 42,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "unsupported-capability");
  assert.equal(seen.length, 0);
});
