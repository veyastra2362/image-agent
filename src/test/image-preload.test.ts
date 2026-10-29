/**
 * preload 是自包含脚本（sandbox 下除 electron 外不能 require 任何模块），
 * channel 名字因此在 preload.ts 内联了一份；这里保证副本不漂移、也不引入运行时依赖。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { IMAGE_CHANNELS } from "../shared/channels.ts";

const preloadSource = readFileSync(path.join(process.cwd(), "src", "main", "preload.ts"), "utf8");

test("preload 内联的 channel 名字与 shared/channels.ts 一致", () => {
  const block = /const CHANNELS = \{([\s\S]*?)\} as const;/.exec(preloadSource)?.[1];
  assert.ok(block, "preload.ts 里应能找到内联的 CHANNELS 常量");

  const parsed: Record<string, string> = {};
  for (const match of block.matchAll(/(\w+):\s*"([^"]+)"/g)) {
    const [, key, value] = match;
    if (key && value) parsed[key] = value;
  }
  assert.deepEqual(parsed, { ...IMAGE_CHANNELS });
});

test("preload 只写 electron 与纯类型导入", () => {
  const runtimeImports: string[] = [];
  for (const match of preloadSource.matchAll(/^import\s+([^;]+?)\s+from\s+"([^"]+)";$/gm)) {
    const [, clause = "", specifier = ""] = match;
    if (specifier === "electron") continue;
    if (/^type\s/.test(clause)) continue;
    runtimeImports.push(specifier);
  }
  assert.deepEqual(runtimeImports, [], "sandbox preload 无法 require 项目内模块，只能用 import type");
});
