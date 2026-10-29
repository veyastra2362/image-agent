// 构建 main + preload + shared 到 out/ 的固定布局（见 prepare-dist.mjs 顶部说明）。
//
// 分三步：清理并写 commonjs 标记 → tsc（rootDir=src）→ 把 src/main、src/shared 的产物
// 提升到 out/main/ 并把 @shared/* 改写成真实相对路径。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const compiledEntry = path.join(repoRoot, "out", "main", "src", "main", "main.js");

function run(label, scriptArgs) {
  const result = spawnSync(process.execPath, scriptArgs, { cwd: repoRoot, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) throw new Error(`${label} 失败（exit ${result.status}）`);
}

run("准备产物目录", ["scripts/prepare-dist.mjs"]);
run("编译 main", ["scripts/run-tsc.mjs", "-p", "tsconfig.main.json"]);
if (!existsSync(compiledEntry)) throw new Error("tsc 没有产出 out/main/src/main/main.js，请检查 tsconfig.main.json");
run("整理产物目录", ["scripts/prepare-dist.mjs", "--after-tsc"]);
