// 开发启动器：以开发模式启动 Electron，然后由 main 自己拉起 Vite dev server，再加载页面。
//
// 之所以不用"先起 Vite、再把它当普通 dev server URL 传给 main"：Electron 的主进程开发模式
// 不运行 Vite 客户端，热更新不会真正生效。现在的流程是：
//   electron . --image-agent-dev-mode=1
//     → main 以 ELECTRON_RUN_AS_NODE 运行 vite.config.ts 的 dev server
//     → main 以普通（非开发）方式加载 http://127.0.0.1:<port>/，renderer 的 HMR 才能工作
// 两种进程同生共死。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

const childEnv = { ...process.env };
// 当前会话里若带了这个变量，Electron 会退化成纯 Node，app 就变成 undefined。
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [".", "--image-agent-dev-mode=1"], {
  stdio: "inherit",
  env: childEnv,
});

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  if (!child.killed) child.kill();
  process.exit(code);
}

child.on("exit", (code) => shutdown(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}
