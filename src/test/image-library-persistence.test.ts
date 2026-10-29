/**
 * 作品落盘、目录设置、密钥加密。全部离线（注入内存文件系统）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  assetFileName,
  isAbsoluteDirectory,
  normalizeLibraryDir,
  type LibrarySettings,
} from "../shared/library";
import { FileJobStore, assetUrl, parseAssetUrl, resolveLibrarySettings } from "../main/library-store";
import { ProviderSettingsStore, type SecretCipher } from "../main/provider-settings-store";
import { DEFAULT_PROVIDER_SETTINGS, type ProviderSettings } from "../shared/provider-settings";
import type { ImageAsset, ImageJob } from "../shared/image-generation";

const INDEX_DIR = "C:\\fake\\userData";
const LIBRARY_DIR = "C:\\fake\\Pictures\\Image Agent";

/** 极简内存文件系统，足够覆盖写盘/重新加载路径。 */
function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string | Uint8Array>(Object.entries(initial));
  const fs = {
    files,
    readFile: (file: string) => {
      const data = files.get(file);
      if (data === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return typeof data === "string" ? data : Buffer.from(data).toString("utf8");
    },
    writeFile: (file: string, data: string | Uint8Array) => void files.set(file, data),
    exists: (file: string) => files.has(file),
    mkdir: () => undefined,
    rename: (from: string, to: string) => {
      const data = files.get(from);
      if (data === undefined) throw new Error("ENOENT");
      files.delete(from);
      files.set(to, data);
    },
    copy: (from: string, to: string) => {
      const data = files.get(from);
      if (data === undefined) throw new Error("ENOENT");
      files.set(to, data);
    },
  };
  return fs;
}

function makeStore(fs: ReturnType<typeof memoryFs>) {
  return new FileJobStore({
    indexDir: INDEX_DIR,
    dir: LIBRARY_DIR,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    exists: fs.exists,
    mkdir: fs.mkdir,
    rename: fs.rename,
    copy: fs.copy,
  });
}

function job(over: Partial<ImageJob> = {}): ImageJob {
  return {
    id: "job-1",
    requestId: "req-library-0001",
    providerId: "fake",
    providerDisplayName: "离线假服务",
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
    ...over,
  };
}

function asset(over: Partial<ImageAsset> = {}): ImageAsset {
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
    ...over,
  };
}

test("路径校验：只接受绝对路径", () => {
  assert.equal(isAbsoluteDirectory("C:\\Users\\me\\Pictures"), true);
  assert.equal(isAbsoluteDirectory("D:/images"), true);
  assert.equal(isAbsoluteDirectory("\\\\nas\\share"), true);
  assert.equal(isAbsoluteDirectory("/home/me/pics"), true);
  assert.equal(isAbsoluteDirectory("relative/dir"), false);
  assert.equal(isAbsoluteDirectory(""), false);
  assert.equal(isAbsoluteDirectory("C:\\a\0b"), false);
  assert.equal(isAbsoluteDirectory(42), false);
  assert.equal(normalizeLibraryDir("C:\\a\\b\\\\"), "C:\\a\\b");
  assert.equal(normalizeLibraryDir("C:\\"), "C:\\");
});

test("文件名只用安全字符，扩展名跟格式走", () => {
  const png = assetFileName("asset-1", "image/png", 1_700_000_000_000);
  assert.match(png, /^[\w.:-]+\.png$/);
  assert.match(assetFileName("asset-1", "image/jpeg", 0), /\.jpg$/);
  assert.match(assetFileName("asset-1", "image/webp", 0), /\.webp$/);
  assert.equal(assetFileName("../../evil", "image/png", 0).includes(".."), false);
});

test("目录设置：坏值退回默认目录", () => {
  assert.deepEqual(resolveLibrarySettings({ dir: "C:\\pics" }, "C:\\default"), { dir: "C:\\pics" });
  assert.deepEqual(resolveLibrarySettings({ dir: "relative" }, "C:\\default"), { dir: "C:\\default" });
  assert.deepEqual(resolveLibrarySettings(undefined, "C:\\default"), { dir: "C:\\default" });
});

test("保存作品：写图片文件、previewUrl 指向 ia-asset，索引可重新加载", () => {
  const fs = memoryFs();
  const store = makeStore(fs);
  store.saveJob(job());
  assert.equal(store.getJob("job-1")?.status, "succeeded");

  const stored = store.saveAsset(asset(), new Uint8Array([1, 2, 3, 4]));
  assert.equal(stored.previewUrl, assetUrl("asset-1"));
  const file = store.fileForAsset("asset-1");
  assert.ok(file);
  assert.ok(file.startsWith(LIBRARY_DIR));
  assert.ok(fs.files.has(file));

  // 重新加载：任务与作品都还在，文件路径恢复。
  const reopened = makeStore(fs);
  reopened.load();
  assert.equal(reopened.listJobs().length, 1);
  assert.equal(reopened.getAsset("asset-1")?.previewUrl, assetUrl("asset-1"));
  assert.equal(reopened.fileForAsset("asset-1"), file);
  assert.equal(reopened.loadWarning, undefined);
  assert.deepEqual(reopened.stats().assets, 1);
});

test("加载时：图片文件缺失的作品被丢弃，并从任务里摘掉", () => {
  const fs = memoryFs();
  const store = makeStore(fs);
  store.saveJob(job());
  store.saveAsset(asset(), new Uint8Array([1, 2, 3, 4]));
  fs.files.delete(store.fileForAsset("asset-1") as string);

  const reopened = makeStore(fs);
  reopened.load();
  assert.equal(reopened.getAsset("asset-1"), undefined);
  assert.deepEqual(reopened.getJob("job-1")?.assetIds, []);
  assert.match(reopened.loadWarning ?? "", /1 张作品/);
});

test("加载时：没结束的任务被标成失败，说明是重启中断", () => {
  const fs = memoryFs();
  const store = makeStore(fs);
  store.saveJob(job({ status: "running", finishedAt: undefined, assetIds: [] }));

  const reopened = makeStore(fs);
  reopened.load();
  const restored = reopened.getJob("job-1");
  assert.equal(restored?.status, "failed");
  assert.match(restored?.error?.message ?? "", /应用重启/);
  assert.equal(reopened.listActiveJobs().length, 0);
});

test("加载时：索引损坏退回空库并备份原文件", () => {
  const fs = memoryFs({ "C:\\fake\\userData\\library.json": "{not json" });
  const store = makeStore(fs);
  store.load();
  assert.equal(store.listJobs().length, 0);
  assert.match(store.loadWarning ?? "", /不是合法 JSON/);
  assert.ok(fs.files.has("C:\\fake\\userData\\library.json.broken"));
});

test("换目录只影响新作品，旧作品仍指向原文件", () => {
  const fs = memoryFs();
  const store = makeStore(fs);
  store.saveJob(job());
  store.saveAsset(asset(), new Uint8Array([1]));
  const oldFile = store.fileForAsset("asset-1");

  store.setDir("D:\\another");
  store.saveJob(job({ id: "job-2", requestId: "req-library-0002", assetIds: ["asset-2"] }));
  store.saveAsset(asset({ id: "asset-2", jobId: "job-2" }), new Uint8Array([2]));

  assert.equal(store.fileForAsset("asset-1"), oldFile);
  assert.ok(store.fileForAsset("asset-2")?.startsWith("D:\\another"));
});

test("ia-asset URL 只能由 id 构成", () => {
  assert.equal(parseAssetUrl(assetUrl("asset-1")), "asset-1");
  assert.equal(parseAssetUrl("ia-asset://asset/a%2Fb"), "a/b");
  assert.equal(parseAssetUrl("ia-asset://other/x"), undefined);
  assert.equal(parseAssetUrl("file:///C:/x.png"), undefined);
  assert.equal(parseAssetUrl("ia-asset://asset/"), undefined);
});

// ---------------------------------------------------------------- 密钥加密

const settings: ProviderSettings = {
  ...DEFAULT_PROVIDER_SETTINGS,
  baseUrl: "https://api.example.com/v1",
  models: ["gpt-image-2"],
};

function fakeCipher(): SecretCipher & { calls: number } {
  const cipher = {
    calls: 0,
    available: true,
    encrypt: (plain: string) => {
      cipher.calls += 1;
      return `enc:${Buffer.from(plain, "utf8").toString("base64")}`;
    },
    decrypt: (payload: string) => {
      if (!payload.startsWith("enc:")) throw new Error("bad payload");
      return Buffer.from(payload.slice(4), "base64").toString("utf8");
    },
  };
  return cipher;
}

test("密钥：有系统加密时只写密文，明文不落盘", () => {
  const fs = memoryFs();
  const store = new ProviderSettingsStore({
    dir: INDEX_DIR,
    cipher: fakeCipher(),
    readFile: fs.readFile,
    writeFile: fs.writeFile,
  });
  store.upsert({ ...settings, id: store.activeId, label: "主服务" });
  store.setApiKey(store.activeId, "sk-secret-value");

  const written = String(fs.files.get(`${INDEX_DIR}\\provider-settings.json`));
  assert.equal(written.includes("sk-secret-value"), false, "明文不能出现在文件里");
  assert.ok(written.includes("enc"));
  assert.equal(store.view(false).keys[store.activeId]?.apiKeyEncrypted, true);
  assert.equal(JSON.stringify(store.view(false)).includes("sk-secret-value"), false);

  const reopened = new ProviderSettingsStore({
    dir: INDEX_DIR,
    cipher: fakeCipher(),
    readFile: fs.readFile,
    writeFile: fs.writeFile,
  });
  reopened.load();
  assert.equal(reopened.keyFor(reopened.activeId), "sk-secret-value");
  assert.equal(reopened.view(false).keys[reopened.activeId]?.apiKeyEncrypted, true);
});

test("密钥：没有系统加密时退回明文，并如实标记未加密", () => {
  const fs = memoryFs();
  const store = new ProviderSettingsStore({ dir: INDEX_DIR, readFile: fs.readFile, writeFile: fs.writeFile });
  store.upsert({ ...settings, id: store.activeId, label: "主服务" });
  store.setApiKey(store.activeId, "sk-plain");
  assert.equal(store.view(false).keys[store.activeId]?.apiKeyEncrypted, false);
  const written = String(fs.files.get(`${INDEX_DIR}\\provider-settings.json`));
  assert.ok(written.includes("sk-plain"));
});

test("密钥：解密失败当作没存过，不崩溃", () => {
  const fs = memoryFs({
    "C:\\fake\\userData\\provider-settings.json": JSON.stringify({
      version: 3,
      profiles: [{ ...settings, id: "default", label: "主服务" }],
      activeId: "default",
      keys: { default: { enc: "garbage" } },
    }),
  });
  const store = new ProviderSettingsStore({
    dir: INDEX_DIR,
    cipher: fakeCipher(),
    readFile: fs.readFile,
    writeFile: fs.writeFile,
  });
  store.load();
  assert.equal(store.keyFor("default"), undefined);
  assert.equal(store.view(false).keys.default?.hasApiKey, false);
});

test("密钥：清空后文件里不再有密钥", () => {
  const fs = memoryFs();
  const store = new ProviderSettingsStore({
    dir: INDEX_DIR,
    cipher: fakeCipher(),
    readFile: fs.readFile,
    writeFile: fs.writeFile,
  });
  store.setApiKey(store.activeId, "sk-x");
  store.clearApiKey(store.activeId);
  const written = String(fs.files.get(`${INDEX_DIR}\\provider-settings.json`));
  assert.equal(written.includes("sk-x"), false);
  assert.equal(store.view(false).keys[store.activeId]?.hasApiKey, false);
});

test("多服务商：新建、切换、删除，最后一个不能删", () => {
  const fs = memoryFs();
  const store = new ProviderSettingsStore({
    dir: INDEX_DIR,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    newId: () => "p-second",
  });
  const first = store.activeId;
  const created = store.create("备用通道");
  assert.equal(created.id, "p-second");
  assert.equal(store.activeId, "p-second");
  assert.equal(store.profiles.length, 2);

  store.upsert({ ...settings, id: first, label: "改名后" });
  assert.equal(store.profiles.find((p) => p.id === first)?.label, "改名后");

  assert.equal(store.setActive(first), true);
  assert.equal(store.activeId, first);

  assert.equal(store.remove("p-second").ok, true);
  assert.equal(store.profiles.length, 1);
  const last = store.remove(first);
  assert.equal(last.ok, false);
  if (!last.ok) assert.match(last.error, /至少/);
});

test("多服务商：旧版单配置文件自动迁移成一条 profile", () => {
  const fs = memoryFs({
    "C:\\fake\\userData\\provider-settings.json": JSON.stringify({
      version: 2,
      settings,
      apiKey: "sk-legacy",
    }),
  });
  const store = new ProviderSettingsStore({ dir: INDEX_DIR, readFile: fs.readFile, writeFile: fs.writeFile });
  store.load();
  assert.equal(store.profiles.length, 1);
  assert.equal(store.profiles[0]?.label, "默认服务商");
  assert.equal(store.keyFor("default"), "sk-legacy");
  assert.equal(store.view(false).keys.default?.apiKeyEncrypted, false);
});

test("多服务商：enabledCount 只算有地址、有模型、有密钥的", () => {
  const fs = memoryFs();
  const store = new ProviderSettingsStore({
    dir: INDEX_DIR,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    newId: () => "p-two",
  });
  store.upsert({ ...settings, id: "default", label: "空的" });
  store.setApiKey("default", "sk");
  assert.equal(store.view(false).enabledCount, 1);
  const second = store.create("第二个");
  assert.equal(store.view(false).enabledCount, 1, "新配置没地址没密钥");
  // 新配置补齐地址与模型后，.env 能给它提供密钥，于是两个都算启用。
  store.upsert({ ...settings, id: second.id, label: "第二个" });
  assert.equal(store.view(true).enabledCount, 2, ".env 提供密钥时两个都算启用");
  assert.equal(store.view(false).enabledCount, 1, "没有 .env 时第二个缺密钥");
});