/**
 * 模型类型判定：名字启发式 + 用途匹配。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { guessModelKind, modelFitsPurpose } from "../shared/model-kind";
import { validateProviderProfile } from "../shared/provider-settings";

test("名字里带 image 的判成图片模型，哪怕同时像 gpt", () => {
  for (const id of ["gpt-image-2", "gpt-image-1-mini", "qwen-image", "flux-pro-1.1", "seedream-4", "dall-e-3", "sdxl"]) {
    assert.equal(guessModelKind(id), "image", id);
  }
});

test("对话模型判成 text", () => {
  for (const id of [
    "deepseek-ai/DeepSeek-V4.1-Flash",
    "GLM-5.3",
    "moonshotai/Kimi-K3",
    "Qwen/Qwen3.8-27B-FP8",
    "zai-org/GLM-5.3-Flash",
    "gpt-4o-mini",
    "claude-3-5-sonnet",
  ]) {
    assert.equal(guessModelKind(id), "text", id);
  }
});

test("看不出来的判 unknown，不要瞎猜", () => {
  for (const id of ["my-custom-endpoint", "model-x", "v2-2024"]) {
    assert.equal(guessModelKind(id), "unknown", id);
  }
});

test("用途匹配：unknown 一律放行", () => {
  assert.equal(modelFitsPurpose("image", "image"), true);
  assert.equal(modelFitsPurpose("image", "text"), false);
  assert.equal(modelFitsPurpose("text", "image"), false);
  assert.equal(modelFitsPurpose("unknown", "image"), true);
  assert.equal(modelFitsPurpose(undefined, "text"), true);
});

test("配置里的 modelKind 只收合法值，非法项被丢弃", () => {
  const base = {
    id: "pmvuh5wam73z",
    kind: "openai-compatible",
    flavor: "images",
    stream: false,
    partialImages: 0,
    timeoutSeconds: 120,
    label: "测试",
    baseUrl: "https://api.example.com/v1",
    models: ["gpt-image-2", "GLM-5.3"],
    defaultModel: "gpt-image-2",
    purpose: "image",
    modelKind: { "gpt-image-2": "image", "GLM-5.3": "text", bad: "nope" },
  };
  const result = validateProviderProfile(base);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.modelKind, { "gpt-image-2": "image", "GLM-5.3": "text" });
});
