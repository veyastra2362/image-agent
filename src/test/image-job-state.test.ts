import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTransition,
  classifyTransition,
  type ImageJob,
  type JobStatus,
} from "../shared/image-generation.ts";

function baseJob(status: JobStatus, overrides: Partial<ImageJob> = {}): ImageJob {
  return {
    id: "job-1",
    requestId: "req-0001-abcdef",
    providerId: "fake",
    providerDisplayName: "本地假服务",
    model: "fake-sync-1",
    modelDisplayName: "Fake Sync 1",
    status,
    prompt: "test",
    submittedPrompt: "test",
    capabilities: {
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
    },
    referenceAssetIds: [],
    uploadsUserAssets: false,
    aspectRatio: "1:1",
    count: 1,
    billableImages: 0,
    attempts: 0,
    createdAt: 1000,
    updatedAt: 1000,
    assetIds: [],
    ...overrides,
  };
}

describe("classifyTransition", () => {
  it("正常推进：queued → submitting → running → succeeded", () => {
    assert.equal(classifyTransition("queued", "submitting").kind, "applied");
    assert.equal(classifyTransition("submitting", "running").kind, "applied");
    assert.equal(classifyTransition("running", "succeeded").kind, "applied");
    assert.equal(
      classifyTransition("submitting", "succeeded").kind,
      "applied",
      "同步完成的 provider 在提交阶段直接成功",
    );
    assert.equal(classifyTransition("submitting", "failed").kind, "applied");
    assert.equal(classifyTransition("queued", "cancelled").kind, "applied");
  });

  it("终态之后的事件一律忽略", () => {
    for (const terminal of ["succeeded", "failed", "cancelled"] as const) {
      for (const next of ["queued", "submitting", "running", "succeeded", "failed", "cancelled"] as const) {
        if (next === terminal) continue;
        assert.equal(classifyTransition(terminal, next).kind, "ignored", `${terminal} → ${next}`);
      }
    }
  });

  it("重复状态是幂等的", () => {
    assert.equal(classifyTransition("running", "running").kind, "same");
    assert.equal(classifyTransition("succeeded", "succeeded").kind, "same");
  });

  it("同一对象上的非法回退被标为 invalid", () => {
    assert.equal(classifyTransition("running", "queued").kind, "invalid");
    assert.equal(classifyTransition("submitting", "queued").kind, "invalid");
    // succeeded 是终态：任何后续状态都按"迟到的重复事件"忽略。
    assert.equal(classifyTransition("succeeded", "running").kind, "ignored");
  });
});

describe("applyTransition", () => {
  it("进入 submitting 时记录 attempts 和 startedAt", () => {
    const job = applyTransition(baseJob("queued"), { status: "submitting", at: 2000 });
    assert.equal(job.status, "submitting");
    assert.equal(job.attempts, 1);
    assert.equal(job.startedAt, 2000);
    assert.equal(job.updatedAt, 2000);
  });

  it("重复的 running 事件不会重复累加或改变状态", () => {
    const running = applyTransition(baseJob("queued"), { status: "submitting", at: 2000 });
    const first = applyTransition(running, { status: "running", at: 3000, remoteTaskId: "remote-1" });
    const second = applyTransition(first, { status: "running", at: 3500 });
    assert.equal(second.status, "running");
    assert.equal(second.attempts, first.attempts);
    assert.equal(second.startedAt, 2000, "startedAt 在首次进入提交阶段时固定");
    assert.equal(second.remoteTaskId, "remote-1");
    assert.equal(second.updatedAt, 3500);
  });

  it("成功后迟到的事件不会把终态改回 running", () => {
    const succeeded = applyTransition(baseJob("running", { updatedAt: 3000 }), { status: "succeeded", at: 4000 });
    assert.equal(succeeded.status, "succeeded");
    assert.equal(succeeded.finishedAt, 4000);

    const late = applyTransition(succeeded, { status: "running", at: 3900 });
    assert.equal(late.status, "succeeded");
    assert.equal(late.updatedAt, 4000, "迟到事件被丢弃，时间戳不变");
  });

  it("取消是 sticky 的：之后的 running 事件被忽略", () => {
    const cancelled = applyTransition(baseJob("queued"), { status: "cancelled", sticky: true, at: 2500 });
    const late = applyTransition(cancelled, { status: "running", at: 2600 });
    assert.equal(late.status, "cancelled");
    assert.equal(late.finishedAt, 2500);
  });

  it("失败保留错误，之后不会变成成功", () => {
    const failed = applyTransition(baseJob("running", { updatedAt: 3000 }), {
      status: "failed",
      at: 3500,
      error: { code: "provider-failed", message: "boom", retryable: true },
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.error?.retryable, true);
    const late = applyTransition(failed, { status: "succeeded", at: 3600 });
    assert.equal(late.status, "failed");
  });

  it("未知/非法转移保持原状态", () => {
    const job = applyTransition(baseJob("submitting", { updatedAt: 1000 }), { status: "queued", at: 1500 });
    assert.equal(job.status, "submitting");
  });

  it("同一状态重复上报是纯函数：字段更新但状态不变", () => {
    const job = baseJob("running", { updatedAt: 1000 });
    const same = applyTransition(job, { status: "running", at: 1200 });
    assert.equal(same.status, "running");
    assert.equal(same.startedAt, undefined, "重复上报不伪造 startedAt");
  });
});
