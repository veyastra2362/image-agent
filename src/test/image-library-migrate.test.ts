/**
 * 作品目录迁移：换文件夹时图片要跟着走，索引里的路径也要更新。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FileJobStore } from "../main/library-store";
import type { ImageJob } from "../shared/image-generation";

function makeJob(id: string): ImageJob {
  const now = Date.now();
  return {
    id,
    requestId: `req-${id}`,
    providerId: "default",
    providerDisplayName: "默认",
    model: "gpt-image-2",
    modelDisplayName: "gpt-image-2",
    status: "succeeded",
    prompt: "x",
    submittedPrompt: "x",
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
      autoSize: true,
      customSize: true,
      sizes: [],
      transcode: false,
    },
    referenceAssetIds: [],
    uploadsUserAssets: false,
    aspectRatio: "1:1",
    count: 1,
    createdAt: now,
    updatedAt: now,
  } as unknown as ImageJob;
}

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "ia-migrate-"));
  const userData = path.join(root, "userData");
  const from = path.join(root, "from");
  const to = path.join(root, "to");
  mkdirSync(userData, { recursive: true });
  mkdirSync(from, { recursive: true });
  const store = new FileJobStore({ indexDir: userData, dir: from });
  return { root, store, from, to };
}

test("换目录时把图片搬过去，索引指向新路径", () => {
  const h = setup();
  try {
    h.store.saveJob(makeJob("job-1"));
    const asset = h.store.saveAsset(
      {
        id: "asset-1",
        jobId: "job-1",
        providerId: "default",
        model: "gpt-image-2",
        prompt: "x",
        width: 1,
        height: 1,
        mimeType: "image/png",
        byteLength: 4,
        createdAt: Date.now(),
        previewUrl: "",
      } as never,
      new Uint8Array([1, 2, 3, 4]),
    );

    const oldFile = h.store.fileForAsset(asset.id);
    assert.ok(oldFile !== undefined && existsSync(oldFile));

    const result = h.store.migrateTo(h.to);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.moved, 1);
    assert.equal(result.failed, 0);

    const newFile = h.store.fileForAsset(asset.id);
    assert.ok(newFile !== undefined);
    assert.ok(newFile.startsWith(h.to), `应搬到新目录：${newFile}`);
    assert.equal(existsSync(newFile), true, "新位置文件存在");
    assert.equal(existsSync(oldFile), false, "旧位置文件已移走");

    // 索引里也要是新路径
    const index = readFileSync(path.join(h.store.indexFile), "utf8");
    assert.ok(index.includes(h.to.replace(/\\/g, "\\\\")) || index.includes(h.to), "索引应记录新目录");
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("目标目录已有同名文件时不覆盖，自动改名", () => {
  const h = setup();
  try {
    h.store.saveJob(makeJob("job-2"));
    const asset = h.store.saveAsset(
      {
        id: "asset-2",
        jobId: "job-2",
        providerId: "default",
        model: "gpt-image-2",
        prompt: "x",
        width: 1,
        height: 1,
        mimeType: "image/png",
        byteLength: 4,
        createdAt: Date.now(),
        previewUrl: "",
      } as never,
      new Uint8Array([9, 9, 9, 9]),
    );
    const fileName = path.basename(h.store.fileForAsset(asset.id) ?? "");
    const targetIndex = path.join(h.to);
    mkdirSync(path.join(targetIndex, "assets"), { recursive: true });
    writeFileSync(path.join(targetIndex, "assets", fileName), "existing");

    const result = h.store.migrateTo(h.to);
    assert.equal(result.ok, true);
    const moved = h.store.fileForAsset(asset.id) ?? "";
    assert.notEqual(path.basename(moved), fileName, "重名时要用新文件名");
    assert.equal(existsSync(moved), true);
    // 原有文件没被覆盖
    assert.equal(readFileSync(path.join(targetIndex, "assets", fileName), "utf8"), "existing");
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("源文件缺失时不算成功，但要如实报告 failed", () => {
  const h = setup();
  try {
    h.store.saveJob(makeJob("job-3"));
    const asset = h.store.saveAsset(
      {
        id: "asset-3",
        jobId: "job-3",
        providerId: "default",
        model: "gpt-image-2",
        prompt: "x",
        width: 1,
        height: 1,
        mimeType: "image/png",
        byteLength: 4,
        createdAt: Date.now(),
        previewUrl: "",
      } as never,
      new Uint8Array([1, 1, 1, 1]),
    );
    rmSync(h.store.fileForAsset(asset.id) ?? "", { force: true });

    const result = h.store.migrateTo(h.to);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.moved, 0);
    assert.equal(result.failed, 1);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});
