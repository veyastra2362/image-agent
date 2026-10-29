// 构建产物的界面冒烟检查。
//
// 用一个临时 Electron 入口加载真实的 out/main/main.js（含 IPC、preload、fake provider），
// 打开 out/renderer/index.html，走一遍"提交 → 生成中 → 完成 → 详情 → 取消"，并逐个状态截图到
// .artifacts/ui/。只使用离线 fake provider：不联网、不需要 API Key、不产生费用。
//
// 用法：npm run build && npm run smoke
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const projectRoot = process.cwd();
const artifacts = path.join(projectRoot, ".artifacts", "ui");
const driverDir = path.join(artifacts, "driver");

// driver-only 环境变量：正式应用从不读取它们，避免发布包出现调试后门。
// 同时把真实服务商的密钥变量清空：冒烟必须离线、免费、结果可复现，
// 否则（例如本地存在 .env）默认模型会变成真实模型，跑一次就真花钱。
const DRIVER_ENV = {
  IMAGE_AGENT_SMOKE_DRIVER: "1",
  IMAGE_AGENT_ARTIFACTS: artifacts,
  IMAGE_AGENT_ROOT: projectRoot,
  IMAGE_AGENT_API_KEY: "",
  IMAGE_AGENT_BASE_URL: "",
};

const driver = String.raw`
const fs = require("node:fs");
const path = require("node:path");

if (process.env.IMAGE_AGENT_SMOKE_DRIVER !== "1") process.exit(2);

const { app, BrowserWindow } = require("electron");
const { pathToFileURL } = require("node:url");

// 加载真实的 out/main/main.js（会创建应用窗口并注册 IPC）。
// CJS 优先用 require；动态 import 作为 Electron 日后切换加载方式的后备。
const appMain = path.join(process.env.IMAGE_AGENT_ROOT, "out/main/main.js");
try {
  require(appMain);
} catch (error) {
  if (error && error.code === "ERR_REQUIRE_ESM") {
    import(pathToFileURL(appMain).href).catch((cause) => {
      console.error("加载应用 main 失败", cause);
      app.exit(3);
    });
  } else {
    console.error("加载应用 main 失败", error);
    app.exit(3);
  }
}

const ROOT = process.env.IMAGE_AGENT_ROOT;
const ARTIFACTS = process.env.IMAGE_AGENT_ARTIFACTS;

const results = [];
const failures = [];
const consoleMessages = [];
let win;
let appWindow;
let page;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (code) => win.webContents.executeJavaScript(code, true);

function check(name, ok, detail) {
  if (ok) results.push({ name, ok: true });
  else failures.push({ name, ok: false, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
}

async function waitFor(expression, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await js("Boolean(" + expression + ")").catch(() => false)) return true;
    await sleep(120);
  }
  throw new Error("等待超时：" + label);
}

async function shot(name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS, name + ".png"), image.toPNG());
}

async function setPrompt(text) {
  await js(
    "(() => { const el = document.querySelector('textarea.field__input--prompt'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, " +
      JSON.stringify(text) +
      "); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()",
  );
}

async function selectModel(fragment) {
  return js(
    "(() => { const s = document.querySelector('.field select'); const o = [...s.options].find((x) => x.textContent.includes(" +
      JSON.stringify(fragment) +
      ")); if (!o) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()",
  );
}

async function run() {
  // 直接驱动应用自己创建的窗口：IPC 只信任该窗口的主 frame，
  // 另开窗口会因为 sender 校验被拒绝（正是 ipc.ts 里的保护）。
  const deadline = Date.now() + 15000;
  while (!win && Date.now() < deadline) {
    win = BrowserWindow.getAllWindows()[0];
    if (!win) await sleep(100);
  }
  if (!win) throw new Error("应用没有创建窗口");
  win.webContents.on("console-message", (event) => {
    if (event.level === "warning" || event.level === "error") consoleMessages.push(String(event.message));
  });
  win.webContents.on("did-fail-load", (_e, code, desc) => consoleMessages.push("did-fail-load " + code + " " + desc));

  win.focus();
  // 页面由应用自己加载；等它挂载出 React 根节点再看后面的断言。
  await waitFor("document.querySelector('.rail') || document.querySelector('.composer')", "renderer 挂载", 20000).catch(
    () => undefined,
  );
  await sleep(500);

  const appWindow = win;
  check("应用主窗口已创建", appWindow !== undefined && !appWindow.isDestroyed(), "");

  page = await js("JSON.stringify({ url: location.href, title: document.title, body: document.body ? document.body.innerText.slice(0, 120) : null, api: typeof window.imageAgent })").catch((error) => "probe-failed " + String(error && error.message));
  console.log("PAGE", page);  const surface = await js(
    "({ api: typeof window.imageAgent, node: typeof require, process: typeof process, keys: window.imageAgent ? Object.keys(window.imageAgent).sort() : [] })",
  );
  check("preload 暴露 window.imageAgent", surface.api === "object", surface);
  check("renderer 无法访问 Node/Electron", surface.node === "undefined" && surface.process === "undefined", surface);
  check(
    "API 只有明确的方法",
    JSON.stringify(surface.keys) === JSON.stringify(["cancelJob", "createJob", "getBootstrap", "onNotification", "onTaskEvent"]),
    surface.keys,
  );

  const csp = await js("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content ?? ''");
  check("CSP 生效", csp.includes("default-src 'none'") && csp.includes("script-src 'self'"), csp);

  await waitFor("document.querySelector('.composer')", "创作表单渲染");
  const modelOptions = await js("[...document.querySelectorAll('.field select option')].map((o) => o.textContent)");
  check("模型列表来自 main", modelOptions.some((text) => text && text.includes("Fake Sync 1")), modelOptions);
  await shot("01-empty-state");

  // ---- 同步模型 ----
  await js("document.querySelector('form.composer button[type=\"submit\"]').click(); true");
  await waitFor("document.querySelector('.result-grid img')", "结果图片出现");
  const resultCount = await js("document.querySelectorAll('.result-grid img').length");
  check("生成结果进入画布", resultCount === 1, resultCount);
  const jobStates = await js("[...document.querySelectorAll('.job-row .status')].map((n) => n.textContent)");
  check("任务栏显示已完成", jobStates.some((text) => text.includes("已完成")), jobStates);
  await shot("02-succeeded");

  await js("document.querySelector('.result-card__button').click(); true");
  await waitFor("document.querySelector('.drawer')", "详情抽屉");
  const drawerText = await js("document.querySelector('.drawer').innerText");
  check("详情显示模型", drawerText.includes("Fake Sync 1"), drawerText.slice(0, 160));
  check("详情显示原始提示词", drawerText.includes("原始提示词"), "");
  check("费用不伪造", drawerText.includes("不产生费用") || drawerText.includes("上游未提供"), "");
  await shot("03-drawer");
  await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
  await sleep(200);
  check("Esc 关闭抽屉", !(await js("Boolean(document.querySelector('.drawer'))")), "");

  // ---- 异步模型：生成中 + 取消 ----
  check("切换到异步模型", (await selectModel("Fake Async 1")) === true, "");
  await sleep(200);
  await setPrompt("异步任务取消测试");
  await js("document.querySelector('form.composer button[type=\"submit\"]').click(); true");
  // 主进程若恰好正在建窗口，页面可能被刷新、executeJavaScript 会抛错；waitFor 本身会重试到超时。
  await waitFor("document.querySelector('.active-job')", "异步任务进行中", 15000).catch(async (error) => {
    page = await js("document.body.innerText.slice(0, 600)");
    throw error;
  });
  await shot("04-async-running");
  await waitFor("document.querySelector('.active-job .button--ghost')", "出现停止按钮", 8000);
  await js("document.querySelector('.active-job .button--ghost').click(); true");
  await waitFor("!document.querySelector('.active-job')", "任务离开进行中列表", 8000);
  const cancelled = await js("[...document.querySelectorAll('.job-row .status')].map((n) => n.textContent)");
  check("取消后显示已取消", cancelled.some((text) => text.includes("已取消")), cancelled);
  await shot("05-cancelled");

  // ---- 参考图：已有作品可作为参考图来源 ----
  const referenceOptions = await js(
    "(() => { const s = [...document.querySelectorAll('.field select')].find((x) => [...x.options].some((o) => o.textContent.includes('不使用参考图'))); return s ? s.options.length : 0; })()",
  );
  check("作品可作为参考图来源", referenceOptions > 1, referenceOptions);

  // ---- 失败态（main 边界拒绝）：篡改提交参数 ----
  const reject = await js(
    "window.imageAgent.createJob({ requestId: 'smoke-reject-0001', providerId: 'unknown', prompt: 'x', count: 1 })",
  );
  check("main 拒绝未知 provider", reject && reject.ok === false && reject.error.code === "unknown-provider", reject);

  // ---- 窄窗口 ----
  win.setSize(720, 700);
  await sleep(500);
  const overflow = await js("({ doc: document.documentElement.scrollWidth, win: window.innerWidth })");
  check("窄窗口无横向溢出", overflow.doc <= overflow.win + 1, overflow);
  await shot("06-narrow");
  win.setSize(1280, 820);
  await sleep(300);

  if (appWindow) appWindow.close();
  win.close();

  const report = { results, failures, consoleMessages, page };
  fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  run().catch((error) => {
    fs.writeFileSync(
      path.join(ARTIFACTS, "report.json"),
      JSON.stringify(
        {
          results,
          failures: [...failures, { name: "driver", ok: false, detail: String((error && error.stack) || error) }],
          consoleMessages,
          page,
        },
        null,
        2,
      ),
    );
    app.exit(1);
  }),
);
app.on("window-all-closed", () => app.exit(1));
`;

await rm(artifacts, { recursive: true, force: true });
await mkdir(driverDir, { recursive: true });
await mkdir(path.join(artifacts, "shots"), { recursive: true });
await writeFile(
  path.join(driverDir, "package.json"),
  JSON.stringify({ name: "image-agent-ui-smoke-driver", type: "commonjs", main: "index.js" }, null, 2),
);
await writeFile(path.join(driverDir, "index.js"), driver, "utf8");

// 产物检查：driver 直接加载正式构建出的 main/preload；renderer 使用生产构建的 index.html。
await readFile(path.join(projectRoot, "out", "main", "main.js"));
await readFile(path.join(projectRoot, "out", "main", "preload.js"));
await readFile(path.join(projectRoot, "out", "renderer", "index.html"));


const child = spawn(electronBinary, [driverDir], {
  stdio: "inherit",
  env: { ...process.env, ...DRIVER_ENV, ELECTRON_RUN_AS_NODE: undefined },
});
const exitCode = await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));

let report;
try {
  report = JSON.parse(await readFile(path.join(artifacts, "report.json"), "utf8"));
} catch {
  report = undefined;
}

if (report) {
  for (const item of report.results) console.log(`✔ ${item.name}`);
  for (const item of report.failures) console.log(`✖ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  if (report.consoleMessages.length > 0) {
    console.log("renderer 控制台：", report.consoleMessages);
    if (report.page) console.log("页面状态：", report.page);
  }
  console.log(`截图目录：${artifacts}`);
} else {
  console.log("未找到冒烟报告，请查看上方 Electron 输出。");
}

process.exit(report ? exitCode : 1);
