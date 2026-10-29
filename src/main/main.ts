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
import { app, BrowserWindow, Menu, net, protocol, safeStorage, shell } from "electron";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { startDevServer } from "./dev-server";
import { parseDevTarget } from "./dev-server-url";
import { registerImageIpc } from "./ipc";
import { registerWindowIpc } from "./window-ipc";
import { registerAppIpc } from "./app-ipc";
import { loadProviderConfig } from "./config";
import { ProviderSettingsStore, type SecretCipher } from "./provider-settings-store";
import { registerSettingsIpc } from "./settings-ipc";
import { ImageGenerationService } from "./image-generation/service";
import { FakeProvider } from "./image-generation/providers/fake";
import { OpenAICompatibleProvider } from "./image-generation/providers/openai-compatible";
import { FileJobStore, parseAssetUrl } from "./library-store";
import { librarySettingsFile, registerLibraryIpc } from "./library-ipc";
import { LIBRARY_DIR_NAME } from "@shared/library";

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
let settingsStore: ProviderSettingsStore | undefined;
let libraryStore: FileJobStore | undefined;
let defaultLibraryDir = "";
let devServerProcess: ChildProcess | undefined;
let disposeExtraIpc: readonly (() => void)[] = [];

/** 关窗之后、进程退出之前，macOS 的 activate 事件不应该被当成"应用已就绪"。 */
let quitting = false;

/**
 * 作品图片通过自定义协议读：
 *  - renderer 只拿到 ia-asset://asset/<id>，拿不到磁盘路径，也没有任意读文件的通道
 *  - 解析时必须命中作品库登记过的 assetId，未知 id 一律 404
 *
 * registerSchemesAsPrivileged 必须在 app ready 之前调用。
 */
protocol.registerSchemesAsPrivileged([
  { scheme: "ia-asset", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// 单实例：重复启动时聚焦已有窗口，避免两个进程写同一份作品库。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName(APP_NAME);
  app.setAppUserModelId(APP_ID);
  // 去掉 Electron 默认菜单（File/Edit/View/Window/Help）。应用内的操作都在界面里，
  // 不再需要系统菜单；这会同时移除菜单栏和它的快捷键绑定。
  Menu.setApplicationMenu(null);
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
    const userData = app.getPath("userData");
    defaultLibraryDir = path.join(app.getPath("pictures"), LIBRARY_DIR_NAME);

    // 作品落盘：索引在 userData，图片在用户选的目录（默认"图片/Image Agent"）。
    libraryStore = new FileJobStore({ indexDir: userData });
    let initialDir = defaultLibraryDir;
    try {
      const raw = JSON.parse(readFileSync(librarySettingsFile(userData), "utf8")) as { dir?: unknown };
      if (typeof raw.dir === "string" && raw.dir.trim() !== "") initialDir = raw.dir;
    } catch {
      // 没有设置文件就用默认目录。
    }
    libraryStore.setDir(initialDir);
    libraryStore.load();
    const store = libraryStore;

    // ia-asset://asset/<id>：只服务作品库里登记过、且文件确实存在的资产。
    protocol.handle("ia-asset", (request) => {
      const assetId = parseAssetUrl(request.url);
      const file = assetId === undefined ? undefined : libraryStore?.fileForAsset(assetId);
      if (file === undefined) return new Response("not found", { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });

    const configured = loadProviderConfig({ rootDir: APP_ROOT });
    // 界面上填的连接配置落在 userData 里；.env 里已有密钥时以 .env 为准（见 store.view）。
    settingsStore = new ProviderSettingsStore({ dir: userData, cipher: systemCipher() });
    settingsStore.load();
    const providers = createProviders(configured, settingsStore);
    const imageService = new ImageGenerationService({
      providers,
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
    disposeExtraIpc = [
      // 窗口控制在启动时注册一次即可：createWindow 会被 activate 再次调用，重复 handle 会抛错。
      registerWindowIpc(() => mainWindow),
      registerAppIpc(() => mainWindow, () => ({
        // 以真正建出来的 provider 为准：只配了 .env 时这里也应当是"已配置"。
        providerConfigured: providerSummary !== undefined,
        ...(providerSummary === undefined ? {} : { providerBaseUrl: providerSummary.baseUrl }),
        models: providerSummary?.models ?? [],
      })),
      registerLibraryIpc({
        getWindow: () => mainWindow,
        get store() {
          return libraryStore as FileJobStore;
        },
        settingsFile: librarySettingsFile(userData),
        defaultDir: defaultLibraryDir,
      }),
      registerSettingsIpc({
        getWindow: () => mainWindow,
        get store() {
          return settingsStore as ProviderSettingsStore;
        },
        envApiKeyPresent: () => configured.configured,
        applyProviders: () => {
          try {
            service?.setProviders(createProviders(configured, settingsStore as ProviderSettingsStore));
            return { ok: true as const };
          } catch (error) {
            return { ok: false as const, error: String((error as Error).message ?? error).slice(0, 200) };
          }
        },
      }),
    ];
    openMainWindow();
  });

  app.on("window-all-closed", () => {
    quitting = true;
    stopDevServer();
    bridge?.dispose();
    for (const dispose of disposeExtraIpc) dispose();
    disposeExtraIpc = [];
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


/** 只用 .env 时的兜底模型（来自当初 GET /v1/models 的实测结果）。 */
const DEFAULT_ENV_MODELS = [
  { id: "gpt-image-2", displayName: "GPT Image 2" },
  { id: "gpt-image-2.5-flare", displayName: "GPT Image 2.5 Flare" },
  { id: "gpt-image-2.5-sunburst", displayName: "GPT Image 2.5 Sunburst" },
] as const;

/** 真正建出来的真实服务摘要，供"关于/设置"显示；没有真实服务时为 undefined。 */
let providerSummary: { baseUrl: string; models: string[]; count: number } | undefined;

/**
 * 组装 provider 列表。
 *
 * 每个"有地址 + 有密钥 + 有模型"的配置都会变成一个独立 provider，因此多个服务商可以并存。
 * 密钥优先级：地址与 .env 相同时用 .env（并覆盖界面上的），否则用界面保存的那把。
 * 只用 .env、没在界面里配过东西时，仍然建一个 provider——不能因为加了多服务商就让老配置失效。
 */
function createProviders(
  configured: ReturnType<typeof loadProviderConfig>,
  store: ProviderSettingsStore,
): (FakeProvider | OpenAICompatibleProvider)[] {
  const providers: (FakeProvider | OpenAICompatibleProvider)[] = [];
  const summary: { baseUrl: string; models: string[] }[] = [];
  let envMatchedProfile = false;

  for (const profile of store.profiles) {
    const envApplies =
      configured.configured && normalizeForCompare(configured.config.baseUrl) === normalizeForCompare(profile.baseUrl);
    const apiKey = envApplies ? configured.config.apiKey : store.keyFor(profile.id);
    if (apiKey === undefined || apiKey === "" || profile.baseUrl === "" || profile.models.length === 0) continue;
    if (envApplies) envMatchedProfile = true;

    try {
      providers.push(
        new OpenAICompatibleProvider({
          id: profile.id,
          displayName: profile.label,
          baseUrl: profile.baseUrl,
          apiKey,
          defaultModel: profile.defaultModel ?? profile.models[0],
          models: profile.models.map((id) => ({ id, displayName: id })),
          timeoutMs: profile.timeoutSeconds * 1000,
        }),
      );
      summary.push({ baseUrl: profile.baseUrl, models: [...profile.models] });
    } catch (error) {
      console.warn(`[image-agent] 服务商「${profile.label}」配置无效，已跳过：${(error as Error).message}`);
    }
  }

  if (!envMatchedProfile && configured.configured) {
    const active = store.active;
    const models = active.models.length > 0 ? [...active.models] : DEFAULT_ENV_MODELS.map((model) => model.id);
    try {
      providers.push(
        new OpenAICompatibleProvider({
          id: "openai-images",
          displayName: "OpenAI 兼容接口（.env）",
          baseUrl: configured.config.baseUrl,
          apiKey: configured.config.apiKey,
          defaultModel: configured.config.defaultModel ?? models[0] ?? "gpt-image-2",
          models: models.map((id) => ({
            id,
            displayName: DEFAULT_ENV_MODELS.find((model) => model.id === id)?.displayName ?? id,
          })),
          timeoutMs: active.timeoutSeconds * 1000,
        }),
      );
      summary.push({ baseUrl: configured.config.baseUrl, models });
    } catch (error) {
      console.warn(`[image-agent] .env 配置无效：${(error as Error).message}`);
    }
  }

  if (summary.length === 0) {
    console.info(
      configured.configured
        ? "[image-agent] 还没有可用的真实服务商：请在设置里填写与 .env 相同的 API URL"
        : `[image-agent] 未启用真实图片服务：${configured.reason}；可在设置里填写服务商`,
    );
  }

  providerSummary =
    summary.length === 0
      ? undefined
      : {
          baseUrl: summary[0]?.baseUrl ?? "",
          models: summary.flatMap((entry) => entry.models),
          count: summary.length,
        };

  // 假 provider 放在最后，真实模型因此成为界面的默认选项。
  // 异步模型故意放慢到约 1.2 秒：既让"生成中 / 取消"在界面上真的看得见，
  // 也让冒烟测试有一个稳定的取消窗口（默认瞬间完成会点不到）。
  providers.push(new FakeProvider({ pollRounds: 3, pollIntervalMs: 400 }));
  return providers;
}
function normalizeForCompare(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}
function systemCipher(): SecretCipher | undefined {
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    return {
      available: true,
      encrypt: (plain) => safeStorage.encryptString(plain).toString("base64"),
      decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, "base64")),
    };
  } catch (error) {
    console.warn("[image-agent] 系统加密不可用，API Key 会以明文保存：", (error as Error).message);
    return undefined;
  }
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
    // 标题栏交给 renderer 自绘：应用名 + 设置 + 窗口按钮都在顶部同一行，
    // 不再有 File/Edit/View 菜单，也不出现系统那条独立的标题。
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 12, y: 12 } }
      : { titleBarOverlay: false }),
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
