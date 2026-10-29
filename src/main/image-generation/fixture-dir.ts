/**
 * 仓库内固定测试图片目录。
 *
 * 源码位于 src/main/image-generation，构建后位于 out/main/main/image-generation，
 * 两种情况到仓库根 fixtures/ 都是上三级目录。
 *
 * 只用 process.argv 定位，不用 __dirname / import.meta.url：同一份源码既要能在 tsc 的
 * CommonJS 构建产物里运行，又要能被 node:test 以 ESM 直接加载，而这两个全局只在其中一种
 * 场景下存在。
 *
 * - Electron 应用：入口是 out/main/main/main.js → 上三级 = 仓库根。
 * - node:test：入口是 src/test/image-*.test.ts → 上三级 = src，再向上一级是仓库根。
 */
import { existsSync } from "node:fs";
import path from "node:path";

function resolveFixtureDir(): string {
  const entry = process.argv[1];
  const depth = (levels: number): string => {
    const start = entry ? path.dirname(entry) : process.cwd();
    return path.resolve(start, ...Array<string>(levels).fill(".."), "fixtures");
  };
  if (existsSync(depth(3))) return depth(3);
  // node:test 从源码直接加载时，入口文件在 src/test/ 下。
  for (const candidate of [depth(4), path.resolve(process.cwd(), "fixtures")]) {
    if (existsSync(path.join(candidate, "fake-square-a.png"))) return candidate;
  }
  throw new Error(`无法定位 fixtures 目录（进程入口：${entry ?? "未知"}）`);
}

export const FIXTURE_DIR = resolveFixtureDir();
