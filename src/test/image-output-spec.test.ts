/**
 * 画面尺寸与格式的纯逻辑：比例表、尺寸推导、自定义比例、校验、转码。
 * 全部离线。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ASPECT_RATIOS,
  PRESET_RATIOS,
  describeOutputSize,
  parseCustomRatio,
  resolveCustomRatioSize,
  resolveRatioSize,
  validateCreateJobInput,
  type OutputSpec,
} from "../shared/image-generation";
import { transcodeImage, qualityForCompression } from "../main/image-generation/transcode";

// fixture 实际是 768×768（它以 IHDR 里的尺寸为准，这里按真实值断言）。
const PNG = readFileSync(path.join(process.cwd(), "fixtures", "fake-square-a.png"));
const FIXTURE_EDGE = PNG.readUInt32BE(16);

const baseInput = {
  requestId: "req-size-0001",
  providerId: "fake",
  prompt: "一只猫",
  count: 1,
};

test("比例表至少有 8 种常用比例 + 自定义", () => {
  assert.ok(PRESET_RATIOS.length >= 8, `只有 ${PRESET_RATIOS.length} 种`);
  for (const expected of ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "5:4", "4:5", "21:9"]) {
    assert.ok(PRESET_RATIOS.includes(expected as never), `缺少 ${expected}`);
  }
  assert.ok(ASPECT_RATIOS.includes("custom"));
});

test("按比例推导尺寸：短边等于档位，长边按比例，并对齐 8", () => {
  assert.deepEqual(resolveRatioSize("1:1", 1024), { width: 1024, height: 1024 });
  assert.deepEqual(resolveRatioSize("16:9", 1024), { width: 1824, height: 1024 });
  assert.deepEqual(resolveRatioSize("9:16", 1024), { width: 1024, height: 1824 });
  // 4:3 × 2K：2048 * 4/3 = 2730.67 → 2730.67/8 = 341.33 → 341 * 8 = 2728（不是 2736）。
  assert.deepEqual(resolveRatioSize("4:3", 2048), { width: 2728, height: 2048 });
  assert.deepEqual(resolveRatioSize("1:1", 4096), { width: 4096, height: 4096 });
  for (const ratio of PRESET_RATIOS) {
    const size = resolveRatioSize(ratio, 1024);
    assert.ok(size, ratio);
    assert.equal(size.width % 8, 0, `${ratio} 宽未对齐`);
    assert.equal(size.height % 8, 0, `${ratio} 高未对齐`);
    assert.equal(Math.min(size.width, size.height), 1024, `${ratio} 短边不等于档位`);
  }
  assert.equal(resolveRatioSize("custom", 1024), undefined);
});

test("自定义比例解析容忍多种写法", () => {
  assert.deepEqual(parseCustomRatio("16:10"), { ratio: "custom", label: "16:10" });
  assert.deepEqual(parseCustomRatio("16 / 10"), { ratio: "custom", label: "16:10" });
  assert.deepEqual(parseCustomRatio("1.5"), { ratio: "custom", label: "1.5:1" });
  assert.deepEqual(parseCustomRatio("2.35:1"), { ratio: "custom", label: "2.35:1" });
  for (const bad of ["", "abc", "0:1", "-1:2", "1:0", "40:1"]) {
    assert.equal(parseCustomRatio(bad), undefined, bad);
  }
});

test("自定义比例推导尺寸与 describeOutputSize 文案", () => {
  assert.deepEqual(resolveCustomRatioSize("16:10", 1024), { width: 1640, height: 1024 });
  const spec = (over: Partial<OutputSpec>): OutputSpec => ({
    mode: "ratio",
    aspectRatio: "1:1",
    resolution: 1024,
    format: "png",
    compression: 0,
    ...over,
  });
  assert.equal(describeOutputSize(spec({})), "将使用 1024×1024");
  assert.equal(describeOutputSize(spec({ resolution: 2048 })), "将使用 2048×2048");
  assert.equal(describeOutputSize(spec({ resolution: 2048, aspectRatio: "16:9" })), "将使用 3640×2048");
  assert.equal(describeOutputSize(spec({ mode: "auto" })), "由模型自行决定尺寸");
  assert.equal(describeOutputSize(spec({ mode: "custom", width: 800, height: 600 })), "将使用 800×600");
  assert.equal(describeOutputSize(spec({ aspectRatio: "custom" }), "16:10"), "将使用 1640×1024");
});

test("校验：自定义必须同时给宽高，其他模式不能带宽高", () => {
  const withSize = validateCreateJobInput({ ...baseInput, sizeMode: "custom", width: 800, height: 600 });
  assert.equal(withSize.ok, true);

  const missing = validateCreateJobInput({ ...baseInput, sizeMode: "custom", width: 800 });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error.message, /宽和高/);

  const stray = validateCreateJobInput({ ...baseInput, sizeMode: "ratio", width: 800, height: 600 });
  assert.equal(stray.ok, false);

  assert.equal(validateCreateJobInput({ ...baseInput, width: 10, height: 10 }).ok, false);
  assert.equal(validateCreateJobInput({ ...baseInput, sizeMode: "weird" }).ok, false);
});

test("校验：格式与压缩率范围", () => {
  assert.equal(validateCreateJobInput({ ...baseInput, format: "webp", compression: 100 }).ok, true);
  assert.equal(validateCreateJobInput({ ...baseInput, format: "gif" }).ok, false);
  assert.equal(validateCreateJobInput({ ...baseInput, compression: 101 }).ok, false);
  assert.equal(validateCreateJobInput({ ...baseInput, compression: -1 }).ok, false);
  assert.equal(validateCreateJobInput({ ...baseInput, compression: 1.5 }).ok, false);
});

test("压缩率映射到质量，png 原样保留", async () => {
  assert.equal(qualityForCompression(0), 100);
  assert.equal(qualityForCompression(100), 40);
  const png = await transcodeImage({ bytes: PNG, format: "png", compression: 50 });
  assert.equal(png.mimeType, "image/png");
  assert.equal(Buffer.compare(png.bytes, PNG), 0, "PNG 不应该被重新编码");
  assert.deepEqual([png.width, png.height], [FIXTURE_EDGE, FIXTURE_EDGE]);
});

test("jpeg / webp 转码产出对应格式，压缩率越高体积越小", async () => {
  const jpegHigh = await transcodeImage({ bytes: PNG, format: "jpeg", compression: 0 });
  const jpegLow = await transcodeImage({ bytes: PNG, format: "jpeg", compression: 100 });
  assert.equal(jpegHigh.mimeType, "image/jpeg");
  assert.deepEqual([jpegHigh.width, jpegHigh.height], [FIXTURE_EDGE, FIXTURE_EDGE]);
  assert.equal(jpegHigh.bytes.subarray(0, 2).toString("hex"), "ffd8");
  assert.ok(jpegLow.bytes.length < jpegHigh.bytes.length, `${jpegLow.bytes.length} !< ${jpegHigh.bytes.length}`);

  const webp = await transcodeImage({ bytes: PNG, format: "webp", compression: 50 });
  assert.equal(webp.mimeType, "image/webp");
  assert.equal(webp.bytes.subarray(8, 12).toString("ascii"), "WEBP");
  assert.deepEqual([webp.width, webp.height], [FIXTURE_EDGE, FIXTURE_EDGE]);
});
