/**
 * 解析开发模式参数。
 *
 * - `--image-agent-dev-mode=1`：由 main 自己启动 Vite dev server（npm run dev 的默认方式）。
 * - `--image-agent-dev-server-url=http://127.0.0.1:PORT/`：连接已经运行的 dev server。
 *
 * 两种都只接受 loopback；其他任何值返回 undefined，于是生产模式加载本地文件。
 * 这个判断单独成文件，便于 node:test 直接覆盖。
 */
const DEV_MODE_FLAG = "--image-agent-dev-mode=1";
const DEV_URL_FLAG = "--image-agent-dev-server-url=";

export type DevTarget = { readonly kind: "spawn" } | { readonly kind: "url"; readonly url: string };

export function parseDevTarget(argv: readonly string[]): DevTarget | undefined {
  if (argv.includes(DEV_MODE_FLAG)) return { kind: "spawn" };

  const arg = argv.find((value) => value.startsWith(DEV_URL_FLAG));
  if (!arg) return undefined;
  const url = parseDevServerUrl(arg.slice(DEV_URL_FLAG.length));
  return url === undefined ? undefined : { kind: "url", url };
}

/** 只接受 loopback http 根地址，避免 main 被指到任意页面。 */
export function parseDevServerUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:") return undefined;
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") return undefined;
  if (url.username || url.password) return undefined;
  if (url.pathname !== "/" && url.pathname !== "") return undefined;
  return url.origin + "/";
}
