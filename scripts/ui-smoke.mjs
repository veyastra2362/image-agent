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
  await waitFor("document.querySelector('.titlebar') || document.querySelector('.composer')", "renderer 挂载", 20000).catch(
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

  // ---- 标题栏：没有原生菜单，导航可点 ----
  const menuProbe = await js("({ menu: typeof window.appWindow, nav: document.querySelectorAll('.titlebar__nav .navitem').length })");
  check("preload 暴露自绘标题栏控制", menuProbe.menu === "object", menuProbe);
  const navItems = await js("[...document.querySelectorAll('.titlebar__nav .navitem')].map((n) => n.textContent)");
  check("标题栏含三个导航项", navItems.length === 3, navItems);
  check(
    "导航项都可以点击",
    (await js("[...document.querySelectorAll('.titlebar__nav .navitem')].every((n) => !n.disabled)")) === true,
    "",
  );

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

  // ---- 画面设置弹窗 ----
  await js("document.querySelector('.size-button').click(); true");
  await waitFor("document.querySelector('.modal')", "画面弹窗打开");
  const modeLabels = await js("[...document.querySelectorAll('.segmented__label')].map((n) => n.textContent)");
  check("画面弹窗有三种模式", modeLabels.length === 3, modeLabels);
  const ratioCount = await js("document.querySelectorAll('.ratio-grid .ratio').length");
  check("预设比例至少 12 种（含自定义）", ratioCount >= 13, ratioCount);
  const tiers = await js("[...document.querySelectorAll('.chips .chip')].map((n) => n.textContent).filter((t) => /K/.test(t))");
  check("有 1K/2K/4K 分辨率档位", tiers.some((t) => t.includes("1K")) && tiers.some((t) => t.includes("2K")) && tiers.some((t) => t.includes("4K")), tiers);
  const preview = await js("document.querySelector('.modal__preview').textContent");
  check("显示将使用的尺寸", /将使用 \d+×\d+/.test(preview), preview);
  await shot("07-size-dialog");
  // 切到 16:9 看预览是否跟着变
  await js(
    "(() => { const b = [...document.querySelectorAll('.ratio')].find((n) => n.textContent.includes('16:9')); b.click(); return true; })()",
  );
  await sleep(150);
  const preview169 = await js("document.querySelector('.modal__preview').textContent");
  check("切换比例后预览更新", preview169 !== preview && /×/.test(preview169), preview169);
  // 取消不应改变设置
  await js("(() => { const b = [...document.querySelectorAll('.modal__foot .button--ghost')].pop(); b.click(); return true; })()");
  await sleep(200);
  check("取消后弹窗关闭", !(await js("Boolean(document.querySelector('.modal'))")), "");
  const sizeSummary = await js("document.querySelector('.size-button__main').textContent");
  check("取消后尺寸设置不变", sizeSummary === preview.replace(/^$/, ""), { sizeSummary, preview });

  // ---- 设置弹窗 ----
  await js("document.querySelector('.titlebar__icon').click(); true");
  await waitFor("document.querySelector('.settings')", "设置弹窗打开");
  const tabs = await js("[...document.querySelectorAll('.settings__tab')].map((n) => n.textContent)");
  check("设置含 API/外观/关于", tabs.join(",") === "API 设置,外观设置,关于", tabs);
  const apiText = await js("document.querySelector('.settings__body').innerText");
  check("API 设置不显示密钥", !/sk-[A-Za-z0-9]{8}/.test(apiText), apiText.slice(0, 120));
  for (const label of ["服务商类型", "API URL", "API Key", "API 接口", "流式传输", "中间步骤图像数", "请求超时"]) {
    check("API 设置含" + label, apiText.includes(label), "");
  }
  const partialChips = await js(
    "[...document.querySelectorAll('.settings__body [role=radio]')].map((n) => n.textContent).filter((t) => /张$/.test(t))",
  );
  check("中间步骤图像可选 0–3", JSON.stringify(partialChips) === JSON.stringify(["0 张", "1 张", "2 张", "3 张"]), partialChips);
  check("提示说明单图拆分", apiText.includes("拆成多个单图"), "");
  check("提示说明额外计费", apiText.includes("额外计费"), "");
  const saved = await js(
    "window.appSettings.save({ settings: { kind: 'openai-compatible', baseUrl: 'https://example.invalid/v1', flavor: 'responses', models: ['gpt-image-2'], stream: true, partialImages: 3, timeoutSeconds: 240 } })",
  );
  check("设置可以保存并重建 provider 表", saved && saved.ok === true, saved);
  await shot("08-settings-api");
  await js("(() => { [...document.querySelectorAll('.settings__tab')].find((n) => n.textContent === '外观设置').click(); return true; })()");
  await sleep(150);
  const themeChips = await js("[...document.querySelectorAll('.settings__body [role=radio]')].map((n) => n.textContent)");
  check(
    "外观设置含跟随系统/白天/黑夜",
    JSON.stringify(themeChips.slice(0, 3)) === JSON.stringify(["跟随系统", "白天", "黑夜"]),
    themeChips,
  );
  await js("(() => { [...document.querySelectorAll('.settings__body [role=radio]')].find((n) => n.textContent === '白天').click(); return true; })()");
  await sleep(150);
  check("切到白天后 data-theme=light", (await js("document.documentElement.dataset.theme")) === "light", "");
  await js("(() => { [...document.querySelectorAll('.settings__body [role=radio]')].find((n) => n.textContent === '黑夜').click(); return true; })()");
  await sleep(150);
  check("切到黑夜后 data-theme=dark", (await js("document.documentElement.dataset.theme")) === "dark", "");
  await js("(() => { [...document.querySelectorAll('.settings__body [role=radio]')].find((n) => n.textContent === '跟随系统').click(); return true; })()");
  await sleep(150);
  check("跟随系统时移除 data-theme", (await js("document.documentElement.dataset.theme ?? ''")) === "", "");
  await shot("09-settings-appearance");
  await js("(() => { [...document.querySelectorAll('.settings__tab')].find((n) => n.textContent === '关于').click(); return true; })()");
  await sleep(150);
  const aboutText = await js("document.querySelector('.settings__body').innerText");
  check("关于页显示版本", /版本/.test(aboutText) && /Electron/.test(aboutText), aboutText.slice(0, 120));
  await shot("10-settings-about");
  await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
  await sleep(200);

  // ---- 作品库与服务商页面可点击 ----
  await js("(() => { [...document.querySelectorAll('.navitem')].find((n) => n.textContent.includes('作品库')).click(); return true; })()");
  await waitFor("document.querySelector('.page')", "作品库页面");
  const libraryCards = await js("document.querySelectorAll('.library-card').length");
  check("作品库显示已有作品", libraryCards >= 1, libraryCards);
  await shot("11-library");
  await js("(() => { [...document.querySelectorAll('.navitem')].find((n) => n.textContent.includes('服务商')).click(); return true; })()");
  await waitFor("document.querySelector('.provider-card')", "服务商页面");
  const providerCards = await js("document.querySelectorAll('.provider-card').length");
  check("服务商页列出服务", providerCards >= 1, providerCards);
  await shot("12-providers");
  await js("(() => { [...document.querySelectorAll('.navitem')].find((n) => n.textContent.includes('创作')).click(); return true; })()");
  await waitFor("document.querySelector('.composer')", "回到创作页");

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
