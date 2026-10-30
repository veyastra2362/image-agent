/**
 * 数据管理：导出 → 清除 → 导入 的往返，以及错误路径。全部离线，用临时目录。
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DataManager } from "../main/data-manager";
import { FavoritesStore } from "../main/favorites-store";
import { FileJobStore } from "../main/library-store";
import { ProviderSettingsStore, type SecretCipher } from "../main/provider-settings-store";
import type { ImageAsset, ImageJob } from "../shared/image-generation";
import type { ProviderProfile } from "../shared/provider-settings";

const cipher: SecretCipher = {
  available: true,
  encrypt: (plain) => `enc:${Buffer.from(plain).toString("base64")}`,
  decrypt: (payload) => Buffer.from(payload.slice(4), "base64").toString("utf8"),
};

function job(id = "job-1"): ImageJob {
  return {
    id,
    requestId: `req-${id}-0001`,
    providerId: "fake",
    providerDisplayName: "本地假服务",
    model: "fake-sync-1",
    modelDisplayName: "Fake Sync 1",
    status: "succeeded",
    prompt: "一只猫",
    submittedPrompt: "一只猫",
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
      autoSize: false,
      customSize: false,
      sizes: [],
      transcode: false,
    },
    referenceAssetIds: [],
    uploadsUserAssets: false,
    aspectRatio: "1:1",
    count: 1,
    attempts: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_500,
    finishedAt: 1_700_000_000_500,
    assetIds: ["asset-1"],
  };
}

function asset(): ImageAsset {
  return {
    id: "asset-1",
    jobId: "job-1",
    providerId: "fake",
    model: "fake-sync-1",
    mimeType: "image/png",
    byteLength: 4,
    width: 1,
    height: 1,
    prompt: "一只猫",
    previewUrl: "",
    createdAt: 1_700_000_000_500,
  };
}

function harness() {
  const root = mkdtempSync(path.join(tmpdir(), "ia-data-"));
  const userData = path.join(root, "userData");
  const libraryDir = path.join(root, "library");
  const store = new FileJobStore({ indexDir: userData, dir: libraryDir });
  const settings = new ProviderSettingsStore({ dir: userData, cipher });
  const favorites = new FavoritesStore({ indexDir: userData });
  const profile: ProviderProfile = {
    id: "default",
    label: "主服务",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    flavor: "images",
    models: ["gpt-image-2"],
    stream: false,
    partialImages: 0,
    timeoutSeconds: 180,
  };
  settings.upsert(profile);
  settings.setApiKey("default", "sk-secret-1");

  const manager = new DataManager({
    userDataDir: userData,
    getStore: () => store,
    getSettings: () => settings,
    getFavorites: () => favorites,
    applyProviders: () => undefined,
  });
  return { root, userData, libraryDir, store, settings, favorites, manager };
}

test("收藏夹跟着作品一起备份、清除、恢复", () => {
  const h = harness();
  try {
    h.store.saveJob(job());
    h.store.saveAsset(asset(), new Uint8Array([1, 2, 3, 4]));
    h.favorites.toggle("asset-1");

    const file = path.join(h.root, "backup-with-fav.zip");
    assert.equal(h.manager.exportTo(file, { settings: false, library: true }).ok, true);

    assert.equal(h.manager.clear({ settings: false, library: true }).ok, true);
    assert.deepEqual(h.favorites.list(), [], "清除作品时收藏也一起清掉");

    assert.equal(h.manager.importFrom(file, { settings: false, library: true }).ok, true);
    assert.deepEqual([...h.favorites.list()], ["asset-1"], "导入后收藏回来");
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("口令加密导出：文件不是 ZIP，错误口令拒绝，正确口令能导入", () => {
  const h = harness();
  try {
    h.store.saveJob(job());
    h.store.saveAsset(asset(), new Uint8Array([1, 2, 3, 4]));

    const sealed = path.join(h.root, "backup.iaz");
    const exported = h.manager.exportTo(sealed, { settings: true, library: true }, "我的口令-8位");
    assert.equal(exported.ok, true, JSON.stringify(exported));
    assert.equal(exported.ok && exported.message.includes("加密"), true);

    // 文件头不是 ZIP
    const head = readFileSync(sealed).subarray(0, 2).toString("latin1");
    assert.notEqual(head, "PK");

    assert.equal(h.manager.clear({ settings: true, library: true }).ok, true);

    // 没给口令：要求补口令，且不修改任何数据
    const needs = h.manager.importFrom(sealed, { settings: true, library: true });
    assert.equal(needs.ok, false);
    assert.equal(needs.ok === false && needs.needsPassphrase, true);
    assert.equal(h.store.allAssets().length, 0);

    // 错口令
    const wrong = h.manager.importFrom(sealed, { settings: true, library: true }, "另一个口令");
    assert.equal(wrong.ok, false);

    // 正口令
    const ok = h.manager.importFrom(sealed, { settings: true, library: true }, "我的口令-8位");
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(h.store.allAssets().length, 1);
    assert.equal(h.store.listJobs().length, 1);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("导出 → 清除 → 导入：任务、图片、配置都回来", () => {
  const h = harness();
  try {
    h.store.saveJob(job());
    h.store.saveAsset(asset(), new Uint8Array([1, 2, 3, 4]));

    const zip = path.join(h.root, "backup.zip");
    const exported = h.manager.exportTo(zip, { settings: true, library: true });
    assert.equal(exported.ok, true, JSON.stringify(exported));
    assert.ok(readdirSync(h.root).includes("backup.zip"));

    // 清空后确认真的空了
    assert.equal(h.manager.clear({ settings: true, library: true }).ok, true);
    assert.equal(h.store.listJobs().length, 0);
    assert.equal(h.store.allAssets().length, 0);
    assert.equal(h.settings.profiles[0]?.baseUrl, "");
    assert.equal(h.settings.keyFor("default"), undefined);

    const imported = h.manager.importFrom(zip, { settings: true, library: true });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    assert.equal(h.store.listJobs().length, 1);
    assert.equal(h.store.allAssets().length, 1);
    assert.equal(h.settings.profiles[0]?.baseUrl, "https://api.example.com/v1");
    assert.equal(h.settings.keyFor("default"), "sk-secret-1");

    // 图片文件重新落到当前目录，并且能通过协议读到
    const file = h.store.fileForAsset("asset-1");
    assert.ok(file !== undefined && file.startsWith(h.libraryDir), String(file));
    assert.deepEqual(readFileSync(file as string), Buffer.from([1, 2, 3, 4]));
    assert.equal(h.store.getAsset("asset-1")?.previewUrl, "ia-asset://asset/asset-1");
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("只勾配置时不打包图片；导入也只恢复勾选的部分", () => {
  const h = harness();
  try {
    h.store.saveJob(job());
    h.store.saveAsset(asset(), new Uint8Array([9, 9]));
    const zip = path.join(h.root, "only-settings.zip");
    assert.equal(h.manager.exportTo(zip, { settings: true, library: false }).ok, true);

    h.manager.clear({ settings: true, library: true });
    const imported = h.manager.importFrom(zip, { settings: true, library: true });
    assert.equal(imported.ok, true);
    // 备份里没有作品，所以只恢复配置
    assert.equal(h.store.listJobs().length, 0);
    assert.equal(h.settings.keyFor("default"), "sk-secret-1");
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("拒绝非本应用的 ZIP、坏文件、以及没勾选任何项", () => {
  const h = harness();
  try {
    const junk = path.join(h.root, "junk.zip");
    writeFileSync(junk, "not a zip");
    const bad = h.manager.importFrom(junk, { settings: true, library: false });
    assert.equal(bad.ok, false);

    const empty = h.manager.exportTo(path.join(h.root, "x.zip"), { settings: false, library: false });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.match(empty.error, /至少勾选/);

    const notExists = h.manager.importFrom(path.join(h.root, "missing.zip"), { settings: true, library: false });
    assert.equal(notExists.ok, false);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("清除只删勾选的部分", () => {
  const h = harness();
  try {
    h.store.saveJob(job());
    h.store.saveAsset(asset(), new Uint8Array([1]));
    const result = h.manager.clear({ settings: false, library: true });
    assert.equal(result.ok, true);
    assert.equal(h.store.listJobs().length, 0);
    // 配置没被清
    assert.equal(h.settings.keyFor("default"), "sk-secret-1");
    assert.equal(h.settings.profiles[0]?.baseUrl, "https://api.example.com/v1");
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("摘要反映当前数据量", () => {
  const h = harness();
  try {
    h.store.saveJob(job());
    h.store.saveAsset(asset(), new Uint8Array([1, 2, 3, 4]));
    const summary = h.manager.summary();
    assert.equal(summary.jobs, 1);
    assert.equal(summary.assets, 1);
    assert.equal(summary.libraryBytes, 4);
    assert.equal(summary.profiles, 1);
    assert.equal(summary.libraryDir, h.libraryDir);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});
