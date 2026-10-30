/**
 * 流式进度：provider 报中间图时，任务上的 partialImages 会更新并发事件。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ImageGenerationService } from "../main/image-generation/service";
import { MemoryJobStore } from "../main/image-generation/store";
import type { ImageProvider, ProviderGenerateRequest } from "../main/image-generation/provider";
import type { ImageCapabilities, ImageTaskEvent } from "../shared/image-generation";

const CAPS: ImageCapabilities = {
  textToImage: true,
  imageToImage: false,
  masks: false,
  referenceImageLimit: 0,
  aspectRatios: ["1:1"],
  outputCountLimit: 1,
  seed: false,
  negativePrompt: false,
  async: false,
  cancel: false,
  autoSize: true,
  customSize: true,
  sizes: [],
  transcode: false,
};

/** 假的流式 provider：先报两张中间图，再返回一张最终图。 */
function streamingProvider(): ImageProvider {
  return {
    descriptor: {
      id: "stream",
      displayName: "流式服务",
      description: "test",
      defaultModel: "m1",
      models: [{ id: "m1", displayName: "M1", capabilities: CAPS }],
      uploadsUserAssets: false,
    },
    getModel: (model) => (model === "m1" ? { id: "m1", displayName: "M1", capabilities: CAPS } : undefined),
    getCapabilities: () => CAPS,
    submit: async (request: ProviderGenerateRequest) => {
      request.onPartialImage?.({ index: 1, bytes: new Uint8Array([1]) });
      await new Promise((resolve) => setTimeout(resolve, 5));
      request.onPartialImage?.({ index: 2, bytes: new Uint8Array([2]) });
      const png = readFileSync(path.join(process.cwd(), "fixtures", "fake-square-a.png"));
      return { state: "completed", images: [{ bytes: new Uint8Array(png), mimeType: "image/png" }] };
    },
    poll: () => Promise.reject(new Error("not used")),
    cancel: () => Promise.resolve(false),
  } as ImageProvider;
}

test("流式中间图会更新到任务上，最终图照常落库", async () => {
  const store = new MemoryJobStore();
  const events: ImageTaskEvent[] = [];
  const service = new ImageGenerationService({
    providers: [streamingProvider()],
    store,
    emit: (event) => events.push(event),
    notify: () => undefined,
  });

  const created = await service.createJob({
    requestId: "req-stream-0001",
    providerId: "stream",
    model: "m1",
    prompt: "stream test",
    count: 1,
    sizeMode: "auto",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const jobId = created.event.job.id;
  for (let i = 0; i < 60; i += 1) {
    const job = service.getBootstrap().jobs.find((entry) => entry.job.id === jobId)?.job;
    if (job?.status === "succeeded" || job?.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const entry = service.getBootstrap().jobs.find((item) => item.job.id === jobId);
  assert.equal(entry?.job.status, "succeeded");
  assert.equal(entry?.job.partialImages, 2, "两次中间图都应记录");
  assert.equal(entry?.assets.length, 1);
  assert.ok(
    events.some((event) => event.job.partialImages === 2),
    "中间图进度要推给界面",
  );
});
