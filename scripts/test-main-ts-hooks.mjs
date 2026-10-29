// node:test 直接运行 src 下的 TypeScript。
//
// - shared/renderer/test 用带 `.ts` 的显式路径；
// - main 里的同目录模块按 tsc 的 CommonJS 习惯写成无扩展名（./dev-server），这里补全为 .ts；
// - main 里对共享代码统一写 `@shared/*`（与 tsconfig 的 paths 同义），这里映射到 src/shared。
// 只影响本项目 src 目录内的导入，不碰 node_modules。
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));
const sharedRoot = path.join(srcRoot, "shared");
const srcRootUrl = pathToFileURL(srcRoot).href.endsWith("/") ? pathToFileURL(srcRoot).href : `${pathToFileURL(srcRoot).href}/`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL ?? "";
    const insideSrc = parent.startsWith("file:///") && decodeURIComponent(parent).replace(/\\/g, "/").includes("/src/");

    if (insideSrc && specifier.startsWith("@shared/")) {
      const target = path.join(sharedRoot, `${specifier.slice("@shared/".length)}.ts`);
      if (existsSync(target)) return nextResolve(pathToFileURL(target).href, context);
    }

    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (insideSrc && isRelative && path.extname(specifier) === "") {
      const candidate = new URL(`${specifier}.ts`, parent);
      if (candidate.href.startsWith(srcRootUrl) && existsSync(fileURLToPath(candidate))) {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
