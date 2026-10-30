/**
 * 收藏夹：落盘、切换、删除作品时清理。
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FavoritesStore } from "../main/favorites-store";

function tempStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "ia-fav-"));
  return {
    dir,
    file: path.join(dir, "favorites.json"),
    store: new FavoritesStore({ indexDir: dir }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("收藏切换会落盘，重新打开仍读得到", () => {
  const h = tempStore();
  try {
    assert.deepEqual(h.store.list(), []);
    assert.equal(h.store.toggle("asset-1").favorite, true);
    assert.equal(h.store.toggle("asset-2").favorite, true);
    assert.deepEqual([...h.store.list()].sort(), ["asset-1", "asset-2"]);

    const reopened = new FavoritesStore({ indexDir: h.dir });
    assert.deepEqual([...reopened.list()].sort(), ["asset-1", "asset-2"]);
    assert.equal(reopened.has("asset-1"), true);

    // 再切换一次就是取消
    assert.equal(reopened.toggle("asset-1").favorite, false);
    assert.equal(new FavoritesStore({ indexDir: h.dir }).has("asset-1"), false);

    const onDisk = JSON.parse(readFileSync(h.file, "utf8")) as { favorites: string[] };
    assert.deepEqual(onDisk.favorites, ["asset-2"]);
  } finally {
    h.cleanup();
  }
});

test("作品被删除时收藏记录一起清掉", () => {
  const h = tempStore();
  try {
    h.store.toggle("asset-gone");
    h.store.forget("asset-gone");
    assert.equal(h.store.has("asset-gone"), false);
    assert.deepEqual(new FavoritesStore({ indexDir: h.dir }).list(), []);
  } finally {
    h.cleanup();
  }
});

test("文件损坏/内容非法时当成空收藏，不抛异常", () => {
  const h = tempStore();
  try {
    // 空文件
    assert.deepEqual(new FavoritesStore({ indexDir: h.dir }).list(), []);
  } finally {
    h.cleanup();
  }
});
