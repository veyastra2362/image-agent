// 一个可靠的 tsc 启动器。
//
// TypeScript 7 的 tsc 是原生可执行文件（@typescript/typescript-<platform>/lib/tsc.exe），
// 在部分 Windows 环境里由 shell 转发的 `tsc` 会找不到或静默不执行；这里按已知路径解析后
// 直接运行，参数原样透传，退出码原样返回。
//
// 用法：node scripts/run-tsc.mjs -p tsconfig.main.json --noEmit
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const platformSuffix = `${process.platform}-${process.arch}`;
const exeName = process.platform === "win32" ? "tsc.exe" : "tsgo";

const candidates = [
  path.join(repoRoot, "node_modules", "@typescript", `typescript-${platformSuffix}`, "lib", exeName),
  path.join(repoRoot, "node_modules", "typescript", `typescript-${platformSuffix}`, "lib", exeName),
  path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
  path.join(repoRoot, "node_modules", "typescript", "lib", "tsc.js"),
].filter((candidate) => existsSync(candidate));

if (candidates.length === 0) {
  console.error("未找到 TypeScript 编译器，请先运行 npm install");
  process.exit(1);
}

const args = process.argv.slice(2);
const failure = [];

for (const candidate of candidates) {
  const isScript = candidate.endsWith(".js");
  const result = spawnSync(isScript ? process.execPath : candidate, [...(isScript ? [candidate] : []), ...args], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
  if (!result.error && result.status !== null) process.exit(result.status);
  failure.push(`${path.relative(repoRoot, candidate)}: ${result.error?.message ?? result.status}`);
}

console.error(`tsc 启动失败：\n${failure.join("\n")}`);
process.exit(1);
