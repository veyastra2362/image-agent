import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkBudget,
  checkCapabilities,
  validateCreateJobInput,
  validateJobId,
  type ImageCapabilities,
} from "../shared/image-generation.ts";
import { parseDevServerUrl, parseDevTarget } from "../main/dev-server-url.ts";

const caps: ImageCapabilities = {
  textToImage: true,
  imageToImage: true,
  masks: false,
  referenceImageLimit: 2,
  aspectRatios: ["1:1", "16:9"],
  outputCountLimit: 4,
  seed: true,
  negativePrompt: false,
  async: true,
  cancel: true,
};

const valid = () => ({
  requestId: "req-1234-abcd",
  providerId: "fake",
  model: "fake-async-1",
  prompt: "  水彩风格的雪山  ",
  count: 2,
});

describe("validateCreateJobInput", () => {
  it("接受合法请求并规范化字符串", () => {
    const result = validateCreateJobInput({ ...valid(), negativePrompt: "  ", seed: 0, aspectRatio: "16:9" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.prompt, "水彩风格的雪山");
    assert.equal(result.value.model, "fake-async-1");
    assert.equal(result.value.negativePrompt, undefined, "空白负面提示词被丢弃");
    assert.equal(result.value.seed, 0);
    assert.deepEqual(result.value.referenceAssetIds, []);
  });

  it("拒绝非对象、数组、null", () => {
    for (const input of [null, undefined, "prompt", 42, []]) {
      const result = validateCreateJobInput(input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "invalid-request");
    }
  });

  it("拒绝注入的额外字段（例如磁盘路径或 URL）", () => {
    const result = validateCreateJobInput({ ...valid(), referenceImagePath: "C:\\Windows\\win.ini" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.message, /未知字段/);
  });

  it("只接受本应用格式的参考图 ID", () => {
    for (const id of ["../../etc/passwd", "file:///C:/x.png", "data:image/png;base64,AAA", "https://x/y.png", "a b"]) {
      const result = validateCreateJobInput({ ...valid(), referenceAssetIds: [id] });
      assert.equal(result.ok, false, id);
    }
    const dup = validateCreateJobInput({ ...valid(), referenceAssetIds: ["asset-1", "asset-1"] });
    assert.equal(dup.ok, false);
  });

  it("数量、seed、预算、比例边界", () => {
    const cases: unknown[] = [
      { count: 0 },
      { count: 5 },
      { count: 1.5 },
      { count: "2" },
      { seed: -1 },
      { seed: 1.5 },
      { seed: 2_147_483_648 },
      { budgetLimit: 0 },
      { budgetLimit: Number.POSITIVE_INFINITY },
      { aspectRatio: "21:9" },
      { requestId: "short" },
      { model: "x".repeat(129) },
    ];
    for (const patch of cases) {
      const result = validateCreateJobInput({ ...valid(), ...(patch as Record<string, unknown>) });
      assert.equal(result.ok, false, JSON.stringify(patch));
    }
  });

  it("按 Unicode 码点计算长度", () => {
    const result = validateCreateJobInput({ ...valid(), prompt: "🐱".repeat(2000) });
    assert.equal(result.ok, true);
    const tooLong = validateCreateJobInput({ ...valid(), prompt: "🐱".repeat(2001) });
    assert.equal(tooLong.ok, false);
  });
});

describe("validateJobId", () => {
  it("只接受简单 ID 字符串", () => {
    assert.equal(validateJobId("job-abc").ok, true);
    for (const bad of ["", "a/b", 12, null, {}, "x".repeat(65)]) {
      assert.equal(validateJobId(bad).ok, false);
    }
  });
});

describe("checkCapabilities", () => {
  it("参考图 / 比例 / 数量 / seed / 负面提示词", () => {
    assert.equal(
      checkCapabilities({ capabilities: caps, referenceCount: 0, aspectRatio: "1:1", count: 1 }),
      null,
    );
    assert.match(
      checkCapabilities({ capabilities: caps, referenceCount: 3, aspectRatio: "1:1", count: 1 }) ?? "",
      /最多接受 2 张/,
    );
    assert.match(
      checkCapabilities({ capabilities: caps, referenceCount: 0, aspectRatio: "9:16", count: 1 }) ?? "",
      /不支持 9:16/,
    );
    assert.match(
      checkCapabilities({ capabilities: caps, referenceCount: 0, aspectRatio: "1:1", count: 5 }) ?? "",
      /最多生成 4 张/,
    );
    assert.match(
      checkCapabilities({ capabilities: caps, referenceCount: 0, aspectRatio: "1:1", count: 1, negativePrompt: "x" }) ??
        "",
      /负面提示词/,
    );
    const noSeed = { ...caps, seed: false };
    assert.match(
      checkCapabilities({ capabilities: noSeed, referenceCount: 0, aspectRatio: "1:1", count: 1, seed: 1 }) ?? "",
      /seed/,
    );
  });
});

describe("checkBudget", () => {
  it("未知价格（0）不拦截", () => {
    assert.deepEqual(checkBudget({ budget: { spent: 100, limit: 1 }, costPerImage: 0, count: 4 }), {
      ok: true,
      cost: 0,
    });
  });

  it("超过本次限额 / 会话预算时在提交前拦截", () => {
    assert.deepEqual(checkBudget({ budget: {}, costPerImage: 0.5, count: 4, requestLimit: 1 }), {
      ok: false,
      cost: 2,
      reason: "request-limit",
    });
    assert.deepEqual(checkBudget({ budget: { spent: 9, limit: 10 }, costPerImage: 0.5, count: 4 }), {
      ok: false,
      cost: 2,
      reason: "total-limit",
    });
    assert.equal(checkBudget({ budget: { spent: 9, limit: 10 }, costPerImage: 0.5, count: 2 }).ok, true);
  });
});

describe("parseDevServerUrl", () => {
  it("只接受 loopback http 地址", () => {
    assert.equal(parseDevServerUrl("http://127.0.0.1:5173/"), "http://127.0.0.1:5173/");
    assert.equal(parseDevServerUrl("http://localhost:5173"), "http://localhost:5173/");
    assert.equal(parseDevServerUrl("http://[::1]:5173/"), "http://[::1]:5173/");
    for (const bad of [
      "https://127.0.0.1:5173/",
      "http://evil.example/",
      "http://127.0.0.1:5173/app",
      "http://user:pass@127.0.0.1:5173/",
      "file:///C:/x.html",
      "::bad",
    ]) {
      assert.equal(parseDevServerUrl(bad), undefined, bad);
    }
  });

  it("开发模式参数只认显式开关与 loopback 地址", () => {
    assert.deepEqual(parseDevTarget(["--image-agent-dev-mode=1"]), { kind: "spawn" });
    assert.deepEqual(parseDevTarget(["--image-agent-dev-server-url=http://127.0.0.1:5173"]), {
      kind: "url",
      url: "http://127.0.0.1:5173/",
    });
    assert.equal(parseDevTarget(["C:\\app"]), undefined);
    assert.equal(parseDevTarget(["--image-agent-dev-server-url=https://evil.example/"]), undefined);
  });
});
