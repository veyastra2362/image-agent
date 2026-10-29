import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const DEV_PORT = Number(process.env.IMAGE_AGENT_DEV_PORT ?? 5173);

/**
 * 开发模式下 <meta> 中的 CSP 需要允许 Vite HMR 的 WebSocket。
 * 只放宽 connect-src 到本机 dev server；生产构建保持 'self'。
 */
function devCsp(): Plugin {
  return {
    name: "image-agent-dev-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        "connect-src 'self'",
        `connect-src 'self' http://127.0.0.1:${DEV_PORT} ws://127.0.0.1:${DEV_PORT}`,
      );
    },
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), devCsp()],
  build: {
    outDir: "../../out/renderer",
    emptyOutDir: true,
    target: "chrome130",
    sourcemap: true,
  },
  server: {
    // 只监听回环地址：不接受来自局域网/其他主机的页面。
    host: "127.0.0.1",
    port: DEV_PORT,
    strictPort: true,
  },
});
