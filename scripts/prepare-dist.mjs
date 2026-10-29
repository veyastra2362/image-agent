// 清空并准备 out/。产物布局（目录深度固定为 2）：
//
//   out/main/main.js         主进程入口（package.json 的 "main" 指向它）
//   out/main/preload.js      preload —— 与 shared/ 同级，因为 Electron 的 sandbox
//                            preload 只能 require 它自己所在目录下的文件
//   out/main/shared/*.js     共享类型、校验与 channel 常量
//   out/main/ipc.js、dev-server*.js、image-generation/*.js
//   out/main/package.json    {"type": "commonjs"}：根 package.json 是 ESM，这里显式标记
//   out/renderer/            Vite 构建的页面
//
// 源码里所有对 src/shared 的引用都写成 "@shared/*"（tsconfig.main.json 的 paths 负责编译期
// 解析）。tsc 会原样保留这个说明符，所以 --after-tsc 阶段按文件在 out/main 中的新位置把它
// 改写成真实的相对路径：
//   out/main/*.js                     → "./shared/*"
//   out/main/image-generation/*.js    → "../shared/*"
//   out/main/image-generation/x/*.js  → "../../shared/*"
//
// 用法：node scripts/prepare-dist.mjs [--after-tsc]
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const TSC_OUTPUT = "out/main/src";
/** 直接落在 out/main/ 根的主进程模块（其余 src/main/*.ts 以目录为单位整体复制）。 */
const ROOT_MODULES = ["dev-server-url", "dev-server", "config", "ipc", "window-ipc", "app-ipc", "settings-ipc", "provider-settings-store", "upstream-probe"];
/** 以目录整体搬到 out/main/ 的模块组。 */
const STAGED_DIRS = ["image-generation"];

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** 把 out/main 内某个模块里的 @shared/* 改写成相对路径。 */
async function resolveSharedSpecifiers(file) {
  const depth = path.dirname(path.relative("out/main", file)).split(path.sep).filter((part) => part !== ".").length;
  const prefix = depth === 0 ? "./" : "../".repeat(depth);
  const source = await readFile(file, "utf8");
  const rewritten = source.replaceAll('require("@shared/', `require("${prefix}shared/`);
  if (rewritten !== source) await writeFile(file, rewritten, "utf8");
}

async function* walkJs(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJs(full);
    else if (entry.name.endsWith(".js")) yield full;
  }
}

if (process.argv.includes("--after-tsc")) {
  if (!(await exists(`${TSC_OUTPUT}/main/main.js`))) {
    throw new Error("未找到 tsc 产物 out/main/src/main/main.js，请先运行 tsc -p tsconfig.main.json");
  }
  await cp(`${TSC_OUTPUT}/shared`, "out/main/shared", { recursive: true });
  for (const entry of ROOT_MODULES) {
    await cp(`${TSC_OUTPUT}/main/${entry}.js`, `out/main/${entry}.js`);
    await cp(`${TSC_OUTPUT}/main/${entry}.js.map`, `out/main/${entry}.js.map`);
  }
  for (const dir of STAGED_DIRS) {
    await cp(`${TSC_OUTPUT}/main/${dir}`, `out/main/${dir}`, { recursive: true });
  }
  await cp(`${TSC_OUTPUT}/main/preload.js`, "out/main/preload.js");
  await cp(`${TSC_OUTPUT}/main/preload.js.map`, "out/main/preload.js.map");
  await rename(`${TSC_OUTPUT}/main/main.js`, "out/main/main.js");
  await rename(`${TSC_OUTPUT}/main/main.js.map`, "out/main/main.js.map");
  await rm(TSC_OUTPUT, { recursive: true, force: true });

  for await (const file of walkJs("out/main")) await resolveSharedSpecifiers(file);
  console.log("staged out/main: main.js, preload.js, ipc.js, config.js, dev-server*.js, image-generation/, shared/");
} else {
  await rm("out/main", { recursive: true, force: true });
  await rm("out/renderer", { recursive: true, force: true });
  await mkdir("out/main", { recursive: true });
  await writeFile("out/main/package.json", `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`, "utf8");
  console.log("prepared out/main (commonjs marker)");
}
