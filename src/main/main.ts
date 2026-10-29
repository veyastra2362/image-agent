/**
 * Electron 主进程入口：创建窗口、注册 image IPC、持有任务服务。
 *
 * 这里不接受命令行里的渲染参数，也不加载任意 URL：开发模式只加载本机 Vite dev server，
 * 生产模式只加载包里 out/renderer/index.html。页面跳转和跨源窗口一律拦截。
 *
 * 构建产物的目录布局与源码不同（见 scripts/prepare-dist.mjs）：
 *   out/main/main.js            主进程
 *   out/main/preload.js         preload
 *   out/main/shared/*.js        共享模块
 *   out/renderer/index.html     Vite 产物
 * 即 main 与 preload 同在 out/main，渲染产物在它上一级的 renderer/。
 */
import { app, BrowserWindow, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { startDevServer } from "./dev-server";
import { parseDevTarget } from "./dev-server-url";
import { registerImageIpc } from "./ipc";
import { ImageGenerationService } from "./image-generation/service";
import { FakeProvider } from "./image-generation/providers/fake";
import { MemoryJobStore } from "./image-generation/store";

const APP_ID = "com.imageagent.desktop";
const APP_NAME = "image-agent";

/** out/main：main.js、preload.js、shared/ 都在这一级（见 scripts/prepare-dist.mjs）。 */
const OUT_DIR = __dirname;
/** out/：renderer/ 在它下面。 */
const BUILD_DIR = path.resolve(OUT_DIR, "..");
/** 仓库根目录（开发模式从这里启动 Vite）。 */
const APP_ROOT = path.resolve(BUILD_DIR, "..");

let mainWindow: BrowserWindow | undefined;
let service: ImageGenerationService | undefined;
let bridge: ReturnType<typeof registerImageIpc> | undefined;
let devServerProcess: ChildProcess | undefined;

// 单实例：重复启动时聚焦已有窗口，避免两个进程写同一份作品库。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName(APP_NAME);
  app.setAppUserModelId(APP_ID);
  start();
}

function start(): void {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    // S1：只有离线 fake provider 和内存作品库；持久化与真实适配器在后续切片替换。
    const store = new MemoryJobStore();
    service = new ImageGenerationService({
      providers: [new FakeProvider()],
      store,
      emit: (event) => bridge?.sendEvent(event),
      notify: (notification) => bridge?.sendNotification(notification),
    });

    // IPC 必须先于窗口注册：renderer 的 preload 一加载就会取 bootstrap，
    // 晚注册会让首批调用直接失败，再弹一个窗口也不会有句柄（activate 分支）。
    bridge = registerImageIpc({
      service,
      getWindowWebContents: () => mainWindow?.webContents,
    });
    mainWindow = createWindow();

    app.on("activate", () => {
      // 没有存活窗口才新建：避免 macOS 上出两个主窗口、状态各走一份。
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        return;
      }
      mainWindow = createWindow();
    });
  });

  app.on("window-all-closed", () => {
    stopDevServer();
    bridge?.dispose();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    service?.dispose();
    stopDevServer();
  });
}

function stopDevServer(): void {
  devServerProcess?.kill();
  devServerProcess = undefined;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: "#1b1b19",
    title: "Image Agent",
    webPreferences: {
      // 与 main 同级，满足 sandbox preload 只能 require 同目录文件的限制。
      preload: path.resolve(OUT_DIR, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // renderer 不需要任何 Node/Electron 内置模块能力。
      webviewTag: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  // 任何页面发起的导航都拦下；外部链接只允许 https 交给系统浏览器。
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  void openRenderer(window).catch((error: unknown) => {
    console.error("加载界面失败", error);
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  return window;
}

/**
 * 开发模式：以 ELECTRON_RUN_AS_NODE 子进程运行 vite.config.ts 的 dev server，
 * 再用普通（非开发模式）方式加载，这样 renderer 的 HMR 才能正常工作。
 */
async function openRenderer(window: BrowserWindow): Promise<void> {
  const devTarget = parseDevTarget(process.argv);
  if (devTarget?.kind === "url") {
    await window.loadURL(devTarget.url);
    return;
  }
  if (devTarget?.kind === "spawn") {
    const devServer = await startDevServer({ repoRoot: APP_ROOT });
    devServerProcess = devServer.process;
    await window.loadURL(devServer.url);
    return;
  }
  await window.loadFile(path.resolve(BUILD_DIR, "renderer", "index.html"));
}
