/**
 * .env / 环境变量读取与 baseUrl 校验。全部离线，不读取真实磁盘上的 .env。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadProviderConfig, normalizeBaseUrl, parseDotEnv } from "../main/config";

const ROOT = "/repo";

function load(dotenv: string | undefined, env: NodeJS.ProcessEnv = {}) {
  return loadProviderConfig({
    rootDir: ROOT,
    env,
    readFile: (file) => {
      if (dotenv === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      assert.ok(file.endsWith(".env"));
      return dotenv;
    },
  });
}

test("parseDotEnv 忽略注释与坏行，去掉两侧引号", () => {
  const parsed = parseDotEnv(
    ["# 注释", "", "A=1", 'B="two words"', "C='single'", "not a pair", "=empty", "D = spaced "].join("\n"),
  );
  assert.deepEqual(parsed, { A: "1", B: "two words", C: "single", D: "spaced" });
});

test("normalizeBaseUrl 只接受 http(s) 且去掉尾部斜杠", () => {
  assert.equal(normalizeBaseUrl("https://img.example.com/v1/"), "https://img.example.com/v1");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080/v1");
  assert.equal(normalizeBaseUrl("ftp://example.com/v1"), undefined);
  assert.equal(normalizeBaseUrl("https://user:pass@example.com/v1"), undefined);
  assert.equal(normalizeBaseUrl("example.com/v1"), undefined);
  assert.equal(normalizeBaseUrl(""), undefined);
});

test("没有 .env 也没有环境变量时不启用真实 provider", () => {
  const result = load(undefined);
  assert.equal(result.configured, false);
  assert.match(result.configured ? "" : result.reason, /未配置/);
});

test("从 .env 读出 key 与 baseUrl", () => {
  const result = load("IMAGE_AGENT_API_KEY=sk-test\nIMAGE_AGENT_BASE_URL=https://api.example.com/v1\n");
  assert.equal(result.configured, true);
  if (!result.configured) return;
  assert.deepEqual(result.config, { apiKey: "sk-test", baseUrl: "https://api.example.com/v1" });
});

test("非空环境变量覆盖 .env", () => {
  const dotenv = "IMAGE_AGENT_API_KEY=from-file\nIMAGE_AGENT_BASE_URL=https://file.example.com/v1\n";
  const result = load(dotenv, { IMAGE_AGENT_API_KEY: "from-env" });
  assert.equal(result.configured, true);
  if (!result.configured) return;
  assert.equal(result.config.apiKey, "from-env");
  assert.equal(result.config.baseUrl, "https://file.example.com/v1");
});

test("显式设为空串的环境变量表示关闭，不读 .env", () => {
  const dotenv = "IMAGE_AGENT_API_KEY=from-file\nIMAGE_AGENT_BASE_URL=https://file.example.com/v1\n";
  const result = load(dotenv, { IMAGE_AGENT_API_KEY: "", IMAGE_AGENT_BASE_URL: "" });
  assert.equal(result.configured, false);
});

test("只有 key 没有 baseUrl 视为未配置，并说明原因", () => {
  const result = load("IMAGE_AGENT_API_KEY=sk-test\n");
  assert.equal(result.configured, false);
  assert.match(result.configured ? "" : result.reason, /BASE_URL/);
});

test("baseUrl 非法时不启用", () => {
  const result = load("IMAGE_AGENT_API_KEY=sk-test\nIMAGE_AGENT_BASE_URL=file:///etc/passwd\n");
  assert.equal(result.configured, false);
});

test("可选指定默认模型", () => {
  const result = load(
    "IMAGE_AGENT_API_KEY=sk-test\nIMAGE_AGENT_BASE_URL=https://api.example.com/v1\nIMAGE_AGENT_MODEL=some-model\n",
  );
  assert.equal(result.configured, true);
  if (!result.configured) return;
  assert.equal(result.config.defaultModel, "some-model");
});
