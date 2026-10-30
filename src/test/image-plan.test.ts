/**
 * Agent Planner 的 ImagePlan 校验：只接受结构化、可校验的内容。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { extractJsonBlock, validateImagePlan } from "../shared/image-plan";

test("从代码块或夹杂文字里抽出 JSON", () => {
  assert.equal(extractJsonBlock('```json\n{"prompt":"x"}\n```'), '{"prompt":"x"}');
  assert.equal(extractJsonBlock('前面废话 {"prompt":"x"} 后面废话'), '{"prompt":"x"}');
  assert.equal(extractJsonBlock("没有 JSON"), undefined);
});

test("合法计划原样通过", () => {
  const result = validateImagePlan({
    prompt: "一只橘猫坐在窗台上，柔和晨光",
    negativePrompt: "文字水印",
    aspectRatio: "16:9",
    count: 2,
    reasoning: "横构图更像照片",
    questions: ["要写实还是插画？"],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.prompt, "一只橘猫坐在窗台上，柔和晨光");
  assert.equal(result.plan.aspectRatio, "16:9");
  assert.equal(result.plan.count, 2);
  assert.deepEqual(result.plan.questions, ["要写实还是插画？"]);
});

test("容忍 ```json 代码块包裹", () => {
  const result = validateImagePlan('说明\n```json\n{"prompt":"一只狗"}\n```');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.plan.prompt, "一只狗");
});

test("越界字段直接丢弃，不猜", () => {
  const result = validateImagePlan({ prompt: "x", aspectRatio: "7:3", count: 99, negativePrompt: "   " });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.aspectRatio, undefined);
  assert.equal(result.plan.count, undefined);
  assert.equal(result.plan.negativePrompt, undefined);
});

test("没有提示词 / 不是 JSON 一律拒绝", () => {
  assert.equal(validateImagePlan({ aspectRatio: "1:1" }).ok, false);
  assert.equal(validateImagePlan("完全不是 JSON").ok, false);
  assert.equal(validateImagePlan({ prompt: "x".repeat(2001) }).ok, false);
});
