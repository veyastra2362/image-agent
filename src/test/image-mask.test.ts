/**
 * 涂抹遮罩：请求体里带 mask、校验只允许单张参考图 + PNG。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { OpenAICompatibleProvider } from "../main/image-generation/providers/openai-compatible";
import { validateCreateJobInput } from "../shared/image-generation";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const MASK_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

const CAPS = {
  textToImage: true,
  imageToImage: true,
  masks: true,
  referenceImageLimit: 1,
  aspectRatios: ["1:1"] as const,
  outputCountLimit: 1,
  seed: false,
  negativePrompt: false,
  async: false,
  cancel: false,
  autoSize: true,
  customSize: true,
  sizes: [] as readonly string[],
  transcode: false,
};

function providerWithCapture(captured: { body?: BodyInit | null }) {
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured.body = init?.body ?? null;
    return new Response(JSON.stringify({ created: 1, data: [{ b64_json: PNG_BASE64 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new OpenAICompatibleProvider({
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    models: [{ id: "gpt-image-2", displayName: "img" }],
    fetchImpl,
  });
}

test("带遮罩时 multipart 里追加 mask 字段", async () => {
  const captured: { body?: BodyInit | null } = {};
  const provider = providerWithCapture(captured);
  await provider.submit(
    {
      model: "gpt-image-2",
      prompt: "把猫换成柴犬",
      referenceAssetIds: ["asset-1"],
      referenceImages: [{ bytes: new Uint8Array(Buffer.from(PNG_BASE64, "base64")), mimeType: "image/png" }],
      mask: { bytes: new Uint8Array(Buffer.from(PNG_BASE64, "base64")), mimeType: "image/png" },
      aspectRatio: "1:1",
      count: 1,
    },
    new AbortController().signal,
  );

  const form = captured.body as FormData;
  assert.ok(form instanceof FormData, "应该走 edits 的 multipart");
  assert.ok(form.get("mask") !== null, "mask 字段应存在");
  assert.equal(form.get("image") !== null, true, "参考图仍在 image 字段");
});

function baseInput(extra: Record<string, unknown>) {
  return {
    requestId: "req-mask-0001",
    providerId: "default",
    prompt: "x",
    referenceAssetIds: ["asset-1"],
    count: 1,
    ...extra,
  };
}

test("遮罩校验：必须 PNG data URL，且只能配一张参考图", () => {
  const ok = validateCreateJobInput(baseInput({ maskDataUrl: MASK_DATA_URL }));
  assert.equal(ok.ok, true);

  const notPng = validateCreateJobInput(baseInput({ maskDataUrl: "data:image/jpeg;base64,AAAA" }));
  assert.equal(notPng.ok, false);

  const twoRefs = validateCreateJobInput(
    baseInput({ referenceAssetIds: ["a", "b"], maskDataUrl: MASK_DATA_URL }),
  );
  assert.equal(twoRefs.ok, false);

  const noRefs = validateCreateJobInput(
    baseInput({ referenceAssetIds: [], maskDataUrl: MASK_DATA_URL }),
  );
  assert.equal(noRefs.ok, false);
});
