/**
 * 仓库内固定测试图片（只读）。
 *
 * fake provider 只返回这里的 fixture，默认测试与开发运行都不访问网络。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_DIR } from "./fixture-dir";

const cache = new Map<string, Promise<Buffer>>();

export function fixturePath(name: string): string {
  if (!/^[a-z0-9-]+\.png$/.test(name)) throw new Error(`非法 fixture 名：${name}`);
  return path.join(FIXTURE_DIR, name);
}

export function readFixture(name: string): Promise<Buffer> {
  const file = fixturePath(name);
  let pending = cache.get(file);
  if (!pending) {
    pending = readFile(file);
    cache.set(file, pending);
  }
  return pending;
}

/** 读取 PNG 的 IHDR 尺寸；不做完整解码，足够在 main 校验写入结果。 */
export function readPngSize(buffer: Buffer): { width: number; height: number } {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("不是合法的 PNG");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
