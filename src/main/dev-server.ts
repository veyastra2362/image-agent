/**
 * 开发模式下由 main 启动 Vite dev server。
 *
 * 用 ELECTRON_RUN_AS_NODE 让 Electron 自带的可执行文件以纯 Node 运行 vite，
 * 这样 dev server 不需要另外假定系统 PATH 里有 node。
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { parseDevServerUrl } from "./dev-server-url";

export interface DevServerHandle {
  readonly url: string;
  readonly process: ChildProcess;
}

export async function startDevServer(options: { repoRoot: string; port?: string }): Promise<DevServerHandle> {
  const { repoRoot } = options;
  const port = options.port ?? process.env.IMAGE_AGENT_DEV_PORT ?? "5173";
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

  const child = spawn(
    process.execPath,
    [viteBin, "--config", path.join(repoRoot, "vite.config.ts"), "--strictPort"],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "inherit"] },
  );

  const fromOutput = await waitForDevServerUrl(child, `http://127.0.0.1:${port}/`);
  const url = parseDevServerUrl(fromOutput);
  if (!url) {
    child.kill();
    throw new Error(`Vite dev server 返回了非 loopback 地址：${fromOutput}`);
  }
  return { url, process: child };
}

function waitForDevServerUrl(child: ChildProcess, fallback: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vite dev server 启动超时")), 20_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Vite dev server 退出（code ${code}）`));
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (text.includes("ready in")) {
        clearTimeout(timer);
        resolve(fallback);
      }
    });
  });
}
