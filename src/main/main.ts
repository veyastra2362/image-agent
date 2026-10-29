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
import { loadProviderConfig } from "./config";
import { ImageGenerationService } from "./image-generation/service";
import { FakeProvider } from "./image-generation/providers/fake";
import { OpenAICompatibleProvider } from "./image-generation/providers/openai-compatible";
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

/** 关窗之后、进程退出之前，macOS 的 activate 事件不应该被当成"应用已就绪"。 */
let quitting = false;

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
    // 离线假 provider 永远在；真实 provider 只在配置了密钥时出现（见 config.ts）。
    const store = new MemoryJobStore();
    const imageService = new ImageGenerationService({
      providers: createProviders(),
      store,
      emit: (event) => bridge?.sendEvent(event),
      notify: (notification) => bridge?.sendNotification(notification),
    });
    service = imageService;

    // service 与 bridge 必须先于窗口就位：renderer 的 preload 一加载就会取 bootstrap。
    // 仍然保留 activate 补建，保证"窗口没建出来"时用户还有一次机会，而不是面对一个死进程。
    bridge = registerImageIpc({
      service: imageService,
      getWindowWebContents: () => mainWindow?.webContents,
    });
    openMainWindow();
  });

  app.on("window-all-closed", () => {
    quitting = true;
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

/**
 * 主窗口的唯一入口：保留引用、去重、并在窗口关闭后清空。
 *
 * 之前是在 whenReady 里直接 createWindow()、activate 里另建一个——窗口一旦被销毁，
 * mainWindow 仍指向死对象，activate 会以为"还活着"而不重建，界面就永远回不来。
 */
function openMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return mainWindow;
  }
  const window = createWindow();
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  return window;
}

/**
 * 应用被激活（macOS 点 Dock 图标）时确保有主窗口。
 * 只在 ready 之后、且不是正在退出时才重建，避免退出过程中又弹出一个空窗口。
 */
app.on("activate", () => {
  if (quitting || !app.isReady()) return;
  openMainWindow();
});

/**
 * 组装 provider 列表。
 *
 * 真实 provider 只在 .env / 环境变量里配好了密钥时创建；没有配置就只留下假 provider，
 * 应用照常可用。密钥本身只留在 main 的这个对象里，renderer 只看到模型与能力。
 */
function createProviders(): (FakeProvider | OpenAICompatibleProvider)[] {
  const providers: (FakeProvider | OpenAICompatibleProvider)[] = [];
  const configured = loadProviderConfig({ rootDir: APP_ROOT });

  if (configured.configured) {
    providers.push(
      new OpenAICompatibleProvider({
        baseUrl: configured.config.baseUrl,
        apiKey: configured.config.apiKey,
        defaultModel: configured.config.defaultModel ?? "gpt-image-2",
        models: [
          { id: "gpt-image-2", displayName: "GPT Image 2" },
          { id: "gpt-image-2.5-flare", displayName: "GPT Image 2.5 Flare" },
          { id: "gpt-image-2.5-sunburst", displayName: "GPT Image 2.5 Sunburst" },
        ],
      }),
    );
  } else {
    console.info(`[image-agent] 未启用真实图片服务：${configured.reason}`);
  }

  // 假 provider 放在最后，真实模型因此成为界面的默认选项。
  providers.push(new FakeProvider());
  return providers;
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
