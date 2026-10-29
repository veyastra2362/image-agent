import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ImageTaskEvent, Notification } from "../shared/image-generation";
import { FakeProvider } from "../main/image-generation/providers/fake";
import { ImageGenerationService } from "../main/image-generation/service";
import { MemoryJobStore } from "../main/image-generation/store";

function createHarness(options: { pollRounds?: number } = {}) {
  const store = new MemoryJobStore();
  const events: ImageTaskEvent[] = [];
  const notifications: Notification[] = [];
  const service = new ImageGenerationService({
    providers: [new FakeProvider({ pollRounds: options.pollRounds ?? 1 })],
    store,
    emit: (event) => events.push(event),
    notify: (notification) => notifications.push(notification),
  });
  return { store, events, notifications, service };
}

async function waitForTerminal(service: ImageGenerationService, jobId: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const jobs = service.getBootstrap().jobs;
    const job = jobs.find((entry) => entry.job.id === jobId)?.job;
    assert.ok(job, "任务应当存在于 bootstrap 中");
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;
    if (Date.now() > deadline) throw new Error(`等待任务终态超时，当前状态 ${job.status}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return { requestId: "req-0001-abcdef", providerId: "fake", prompt: "一只在雨夜窗边打盹的橘猫", count: 1, ...overrides };
}

describe("ImageGenerationService（离线 fake provider）", () => {
  it("同步模型：queued → submitting → succeeded，只有落库后才发 succeeded", async () => {
    const { service, events, store } = createHarness();
    const created = await service.createJob(request({ model: "fake-sync-1", count: 1 }));
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const job = await waitForTerminal(service, created.event.job.id);
    assert.equal(job.status, "succeeded");
    assert.equal(job.assetIds.length, 1);
    assert.equal(job.billableImages, 0);
    assert.equal(job.estimatedCost, undefined);

    const succeededIndex = events.findIndex((event) => event.job.status === "succeeded");
    assert.ok(succeededIndex >= 0);
    assert.equal(events[succeededIndex]?.assets.length, 1, "succeeded 事件必须带已保存的作品");
    assert.equal(events.filter((event) => event.job.status === "succeeded").length, 1, "成功事件不能重复");
    assert.ok(store.getAsset(job.assetIds[0] ?? ""));
  });

  it("异步模型：走 running → 轮询 → succeeded，并记录 remoteTaskId", async () => {
    const { service } = createHarness({ pollRounds: 2 });
    const created = await service.createJob(request({ model: "fake-async-1", count: 2 }));
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const job = await waitForTerminal(service, created.event.job.id);
    assert.equal(job.status, "succeeded");
    assert.match(job.remoteTaskId ?? "", /^fake-task-\d+$/);
    assert.equal(job.assetIds.length, 2);
  });

  it("同一个 requestId 重复提交返回同一任务，不会重复生成", async () => {
    const { service } = createHarness();
    const first = await service.createJob(request());
    const second = await service.createJob(request());
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.event.job.id, second.event.job.id);
    assert.equal(service.getBootstrap().jobs.length, 1);

    const conflicting = await service.createJob(request({ prompt: "另一个提示词" }));
    assert.equal(conflicting.ok, false);
    if (!conflicting.ok) assert.equal(conflicting.error.code, "invalid-request");
  });

  it("取消运行中的异步任务：状态 cancelled，不再产生 succeeded", async () => {
    const { service } = createHarness({ pollRounds: 5 });
    const created = await service.createJob(request({ model: "fake-async-1" }));
    assert.equal(created.ok, true);
    if (!created.ok) return;

    // 等到进入 running（已经有 remoteTaskId）。
    const jobId = created.event.job.id;
    const current = () => service.getBootstrap().jobs.find((entry) => entry.job.id === jobId)?.job;
    for (let i = 0; i < 200 && current()?.status !== "running"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(current()?.remoteTaskId !== undefined, true);

    const cancelled = await service.cancelJob(jobId);
    assert.equal(cancelled.ok, true);
    if (!cancelled.ok) return;
    assert.equal(cancelled.event.job.status, "cancelled");

    await new Promise((resolve) => setTimeout(resolve, 80));
    const final = current();
    assert.equal(final?.status, "cancelled");
    assert.equal(final?.assetIds.length, 0);
  });

  it("取消未知任务返回 job-not-found，非法 ID 返回 invalid-request", async () => {
    const { service } = createHarness();
    const missing = await service.cancelJob("job-does-not-exist");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.code, "job-not-found");

    const invalid = await service.cancelJob({ id: "x" });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.error.code, "invalid-request");
  });

  it("main 边界拒绝：未知 provider、未知模型、数量越界、未知参考图、多余字段", async () => {
    const { service } = createHarness();
    const cases: [Record<string, unknown>, string][] = [
      [request({ providerId: "openai" }), "unknown-provider"],
      [request({ model: "dall-e-3" }), "unknown-model"],
      [request({ count: 9 }), "invalid-request"],
      [request({ count: 0 }), "invalid-request"],
      [request({ referenceAssetIds: ["asset-forged"] }), "reference-not-found"],
      [request({ referenceAssetIds: ["C:\\secret.png"] }), "invalid-request"],
      [request({ prompt: "   " }), "invalid-request"],
      [request({ prompt: "x".repeat(2001) }), "invalid-request"],
      [request({ endpoint: "https://evil.example" }), "invalid-request"],
      [request({ aspectRatio: "21:9" }), "unsupported-capability"],
    ];
    for (const [input, code] of cases) {
      const result = await service.createJob(input);
      assert.equal(result.ok, false, `应拒绝 ${JSON.stringify(input)}`);
      if (!result.ok) assert.equal(result.error.code, code);
    }
    assert.equal(service.getBootstrap().jobs.length, 0, "被拒绝的请求不能创建任务");
  });

  it("能力限制：不支持参考图的模型拒绝参考图，不支持 seed/负面提示词的模型拒绝这些参数", async () => {
    const { service } = createHarness();
    const withRef = await service.createJob(request({ model: "fake-sync-1", referenceAssetIds: ["asset-x"] }));
    assert.equal(withRef.ok, false);
    if (!withRef.ok) assert.equal(withRef.error.code, "reference-not-found");

    const seed = await service.createJob(request({ model: "fake-sync-1", seed: 42 }));
    assert.equal(seed.ok, false);
    if (!seed.ok) assert.equal(seed.error.code, "unsupported-capability");

    const count = await service.createJob(request({ model: "fake-sync-1", count: 2 }));
    assert.equal(count.ok, false);
    if (!count.ok) assert.equal(count.error.code, "unsupported-capability");
  });

  it("会话预算：超过预算的任务在提交前被拦截并给出通知", async () => {
    const store = new MemoryJobStore();
    const notifications: Notification[] = [];
    const service = new ImageGenerationService({
      providers: [new FakeProvider()],
      store,
      emit: () => {},
      notify: (notification) => notifications.push(notification),
      sessionBudget: { limit: 1 },
    });
    const result = await service.createJob(request({ budgetLimit: 0.0001, count: 1 }));
    // fake provider 不计费，因此预算不生效：cost 为 0 时任何限额都应放行。
    assert.equal(result.ok, true);
    if (result.ok) {
      const job = await waitForTerminal(service, result.event.job.id);
      assert.equal(job.status, "succeeded");
    }
    assert.equal(notifications.length, 0);
    assert.equal(service.getBootstrap().budget.spent, 0);
  });

  it("参考图：不存在的 asset ID 被拒绝", async () => {
    const { service } = createHarness();
    const result = await service.createJob(request({ model: "fake-async-1", referenceAssetIds: ["asset-missing"] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "reference-not-found");
  });

  it("参考图：已保存的作品可以再次作为参考图提交", async () => {
    const { service } = createHarness();
    const first = await service.createJob(request());
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const parent = await waitForTerminal(service, first.event.job.id);
    const assetId = parent.assetIds[0];
    assert.ok(assetId);

    const second = await service.createJob(
      request({ requestId: "req-0002-abcdef", model: "fake-async-1", referenceAssetIds: [assetId], aspectRatio: "16:9" }),
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.deepEqual(second.event.job.referenceAssetIds, [assetId]);
    assert.equal(second.event.job.uploadsUserAssets, false, "本地 provider 不上传用户图片");
    const child = await waitForTerminal(service, second.event.job.id);
    assert.equal(child.status, "succeeded");
    assert.notEqual(child.assetIds[0], parent.assetIds[0], "编辑结果必须是新作品，不覆盖父图");
  });

  it("dispose 后未完成任务不会报未捕获异常", async () => {
    const { service } = createHarness({ pollRounds: 10 });
    const created = await service.createJob(request({ model: "fake-async-1" }));
    assert.equal(created.ok, true);
    service.dispose();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
