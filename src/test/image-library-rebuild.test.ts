/**
 * 作品索引重建与单张删除：用真实临时目录跑（这两条路径本来就走真实 fs）。
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readImageSize } from "../main/image-size";
import { FileJobStore } from "../main/library-store";

const ROOT = path.join(process.cwd(), "fixtures");

function tempLibrary() {
  const dir = mkdtempSync(path.join(tmpdir(), "ia-rebuild-"));
  const assetsDir = path.join(dir, "assets");
  mkdirSync(assetsDir, { recursive: true });
  const store = new FileJobStore({ indexDir: path.join(dir, "userData"), dir });
  return { dir, assetsDir, store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 复制一张真实 PNG 进作品目录，文件名按 assetFileName 的形状。 */
function placePng(assetsDir: string, assetId: string, source = "fake-square-a.png"): string {
  const target = path.join(assetsDir, `2026-10-30_10-00-00-000_${assetId}.png`);
  writeFileSync(target, readFileSync(path.join(ROOT, source)));
  return target;
}

test("从文件头读出 PNG / JPEG 尺寸", () => {
  const png = readFileSync(path.join(ROOT, "fake-square-a.png"));
  const size = readImageSize(png);
  assert.equal(size?.mimeType, "image/png");
  assert.equal(size?.width, 768);
  assert.equal(size?.height, 768);
});

test("索引丢了以后能扫描文件夹重建，尺寸从文件读出", () => {
  const { assetsDir, store, cleanup } = tempLibrary();
  try {
    placePng(assetsDir, "asset-recovered-1");
    const result = store.rebuildIndex();
    assert.equal(result.recovered, 1);
    assert.equal(store.allAssets().length, 1);
    const asset = store.allAssets()[0];
    assert.equal(asset?.id, "asset-recovered-1");
    assert.equal(asset?.width, 768);
    assert.equal(asset?.height, 768);
    assert.match(asset?.prompt ?? "", /从文件恢复/);
    // 任务也补出来了，详情抽屉才有东西显示
    assert.equal(store.listJobs().length, 1);
    assert.equal(store.listJobs()[0]?.status, "succeeded");
    // 第二次扫描不会重复登记
    assert.equal(store.rebuildIndex().recovered, 0);
  } finally {
    cleanup();
  }
});

test("扫描时跳过不像作品的文件", () => {
  const { assetsDir, store, cleanup } = tempLibrary();
  try {
    writeFileSync(path.join(assetsDir, "readme.txt"), "not an image");
    placePng(assetsDir, "asset-ok");
    const result = store.rebuildIndex();
    assert.equal(result.recovered, 1);
    assert.ok(result.skipped >= 1);
  } finally {
    cleanup();
  }
});

test("删除单张作品会连文件一起删，任务没有作品了就一起清掉", () => {
  const { assetsDir, store, cleanup } = tempLibrary();
  try {
    const file = placePng(assetsDir, "asset-del");
    store.rebuildIndex();
    const before = readdirSync(assetsDir).length;
    const removed = store.deleteAsset("asset-del");
    assert.equal(removed.ok, true);
    assert.equal(removed.removedFile, true);
    assert.equal(store.allAssets().length, 0);
    assert.equal(store.listJobs().length, 0);
    assert.equal(readdirSync(assetsDir).length, before - 1);
    assert.equal(statSync(file, { throwIfNoEntry: false }), undefined);
  } finally {
    cleanup();
  }
});

test("删除不存在的作品返回 false，不动别人", () => {
  const { assetsDir, store, cleanup } = tempLibrary();
  try {
    placePng(assetsDir, "asset-keep");
    store.rebuildIndex();
    assert.equal(store.deleteAsset("asset-nope").ok, false);
    assert.equal(store.allAssets().length, 1);
  } finally {
    cleanup();
  }
});
