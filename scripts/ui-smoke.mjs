// 构建产物的界面冒烟检查。
//
// 用一个临时 Electron 入口加载真实的 out/main/main.js（含 IPC、preload、fake provider），
// 打开 out/renderer/index.html，走一遍"提交 → 生成中 → 完成 → 详情 → 取消"，并逐个状态截图到
// .artifacts/ui/。只使用离线 fake provider：不联网、不需要 API Key、不产生费用。
//
// 用法：npm run build && npm run smoke
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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
// 本地桩服务：只实现 GET /v1/models，用来验证"获取上游模型 → 二级弹窗"这条真实路径。
// 它只监听 127.0.0.1 的随机端口，不联网。
const modelsStub = createServer((req, res) => {
  if (req.method === "GET" && (req.url ?? "").endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "stub-model-a" }, { id: "stub-model-b" }] }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "not found" } }));
});
await new Promise((resolve) => modelsStub.listen(0, "127.0.0.1", resolve));
const stubPort = modelsStub.address().port;

const DRIVER_ENV = {
  IMAGE_AGENT_SMOKE_DRIVER: "1",
  IMAGE_AGENT_ARTIFACTS: artifacts,
  IMAGE_AGENT_ROOT: projectRoot,
  IMAGE_AGENT_STUB_URL: `http://127.0.0.1:${stubPort}/v1`,
};

const driver = String.raw`
const fs = require("node:fs");
const path = require("node:path");

if (process.env.IMAGE_AGENT_SMOKE_DRIVER !== "1") process.exit(2);

const { app, BrowserWindow } = require("electron");
const { pathToFileURL } = require("node:url");

// 隔离运行环境：userData 与作品目录都放进 artifacts，避免污染真实配置、
// 也避免上一轮的作品被持久化后带进这一轮。
const ARTIFACT_ROOT = process.env.IMAGE_AGENT_ARTIFACTS;
const USER_DATA = path.join(ARTIFACT_ROOT, "userdata");
const LIBRARY_DIR = path.join(ARTIFACT_ROOT, "library");
fs.mkdirSync(USER_DATA, { recursive: true });
fs.mkdirSync(LIBRARY_DIR, { recursive: true });
fs.writeFileSync(path.join(USER_DATA, "library-settings.json"), JSON.stringify({ dir: LIBRARY_DIR }));
app.setPath("userData", USER_DATA);

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
    "(() => { const el = document.querySelector('textarea.dock__input'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, " +
      JSON.stringify(text) +
      "); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()",
  );
}

async function selectModel(fragment) {
  // 自绘下拉：先点开触发器，再点选项。
  await js("(() => { const t = document.querySelector('.sidebar .select__trigger'); if (t) t.click(); return true; })()");
  await sleep(120);
  const picked = await js(
    "(() => { const o = [...document.querySelectorAll('.sidebar .select__option')].find((x) => x.textContent.includes(" +
      JSON.stringify(fragment) +
      ")); if (!o) return false; o.click(); return true; })()",
  );
  await sleep(120);
  return picked;
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
  await waitFor("document.querySelector('.titlebar') || document.querySelector('.dock')", "renderer 挂载", 20000).catch(
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
  // 顶部菜单：应用 / 编辑，编辑项要能点开
  const menuButtons = await js("[...document.querySelectorAll('.menubar__button')].map((n) => n.textContent)");
  check("顶部有应用与编辑菜单", JSON.stringify(menuButtons) === JSON.stringify(["应用", "编辑"]), menuButtons);
  await js("(() => { [...document.querySelectorAll('.menubar__button')].find((n) => n.textContent === '编辑').click(); return true; })()");
  await waitFor("document.querySelector('.menu')", "编辑菜单展开");
  await shot("00-edit-menu");
  const editItems = await js("[...document.querySelectorAll('.menu__item')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())");
  check(
    "编辑菜单含撤销/重做/剪切/复制/粘贴/删除/全选",
    ["撤销", "重做", "剪切", "复制", "粘贴", "删除", "全选"].every((label) => editItems.some((item) => item.startsWith(label))),
    editItems,
  );
  check("编辑动作走 main（返回 true）", (await js("window.appInfo.edit('selectAll')")) === true, "");
  // 全选只用于证明动作可达，清掉选区免得后面的截图整片高亮。
  await js("window.getSelection().removeAllRanges(); true");
  await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
  await sleep(150);
  check("Esc 关闭菜单", !(await js("Boolean(document.querySelector('.menu'))")), "");

  // 应用菜单能打开设置
  await js("(() => { [...document.querySelectorAll('.menubar__button')].find((n) => n.textContent === '应用').click(); return true; })()");
  await waitFor("document.querySelector('.menu')", "应用菜单展开");
  const appMenuText = await js("document.querySelector('.menu').innerText");
  check("应用菜单含设置/打开作品文件夹/退出", /设置/.test(appMenuText) && /作品文件夹/.test(appMenuText) && /退出/.test(appMenuText), appMenuText);
  await js("(() => { [...document.querySelectorAll('.menu__item')].find((n) => n.textContent.includes('设置')).click(); return true; })()");
  await waitFor("document.querySelector('.settings')", "从菜单打开设置");
  check("菜单能打开设置", true, "");
  await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
  await sleep(250);

  // 侧栏可以收起/展开，且有可点的 UI
  const toggleProbe = await js("({ toggle: Boolean(document.querySelector('.titlebar__toggle')), collapse: Boolean(document.querySelector('.sidebar__collapse')) })");
  check("顶栏有侧栏开关", toggleProbe.toggle === true, toggleProbe);
  check("侧栏内有收起按钮", toggleProbe.collapse === true, toggleProbe);
  await js("document.querySelector('.sidebar__collapse').click(); true");
  await sleep(250);
  check("收起后侧栏不可见", !(await js("Boolean(document.querySelector('.sidebar') && document.querySelector('.sidebar').offsetParent)")), "");
  const collapsedWidth = await js("document.querySelector('.canvas').getBoundingClientRect().width");
  await shot("14-sidebar-collapsed");
  await js("document.querySelector('.titlebar__toggle').click(); true");
  await sleep(250);
  check("展开后侧栏回来", (await js("Boolean(document.querySelector('.sidebar') && document.querySelector('.sidebar').offsetParent)")) === true, "");
  check("展开后画布变窄", (await js("document.querySelector('.canvas').getBoundingClientRect().width")) < collapsedWidth, JSON.stringify({ collapsedWidth }));

  // 导航和应用/编辑同一套文字按钮样式（比未选中项，选中项本来就有底色）
  // 自绘下拉：点开后有选项列表和勾选标记
  await js("document.querySelector('.dock .select__trigger').click(); true");
  await waitFor("document.querySelector('.select__menu')", "下拉菜单展开");
  const selectOptions = await js("[...document.querySelectorAll('.select__option')].map((n) => n.textContent)");
  check("下拉是自绘菜单", selectOptions.length >= 2, selectOptions);
  const groups = await js("[...document.querySelectorAll('.model-select__group-title')].map((n) => n.textContent)");
  check("模型下拉按服务商分组", groups.length >= 1, groups);
  const chevron = await js("getComputedStyle(document.querySelector('.dock .model-select .select__chevron')).transform");
  check("展开时箭头旋转", chevron !== "none", chevron);
  await shot("17-model-menu");
  check(
    "选中项带勾",
    (await js("Boolean(document.querySelector('.select__option.is-selected svg'))")) === true,
    "",
  );
  await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
  await sleep(150);

  const navStyle = await js(
    "(() => { const n = document.querySelectorAll('.navitem')[1]; const m = document.querySelector('.menubar__button'); const a = getComputedStyle(n); const b = getComputedStyle(m); return { nav: [a.fontSize, a.borderTopWidth, a.backgroundColor], menu: [b.fontSize, b.borderTopWidth, b.backgroundColor] }; })()",
  );
  check("导航与菜单按钮同款样式", JSON.stringify(navStyle.nav) === JSON.stringify(navStyle.menu), navStyle);

  // 选中态：淡填充，而不是下划线
  const activeStyle = await js(
    "(() => { const n = document.querySelector('.navitem.is-active'); const s = getComputedStyle(n); return { bg: s.backgroundColor, weight: s.fontWeight, shadow: s.boxShadow }; })()",
  );
  check("选中项是淡填充而非下划线", activeStyle.shadow === "none" && activeStyle.bg !== "rgba(0, 0, 0, 0)", activeStyle);

  // 连点侧栏开关不应触发标题栏双击最大化
  await js("document.querySelector('.titlebar__toggle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true");
  await sleep(300);
  check("双击开关不会最大化窗口", (await js("window.appWindow.isMaximized()")) === false, "");

  // 侧栏开关必须在拖拽区之外，否则真实鼠标点不动
  const dragProbe = await js(
    "(() => { const s = getComputedStyle(document.querySelector('.titlebar__toggle')); return s.getPropertyValue('-webkit-app-region') || s.webkitAppRegion || ''; })()",
  );
  check("侧栏开关不在窗口拖拽区", dragProbe === "no-drag", dragProbe);

  // 顶栏不再显示应用名
  check("顶栏没有应用名字幕", (await js("!document.querySelector('.titlebar__name')")) === true, "");

  const navItems = await js("[...document.querySelectorAll('.titlebar__nav .navitem')].map((n) => n.textContent)");
  check("导航只剩文字", JSON.stringify(navItems) === JSON.stringify(["创作", "作品库"]), navItems);
  check("标题栏含两个导航项（服务商页已下线）", navItems.length === 2, navItems);
  check(
    "导航项都可以点击",
    (await js("[...document.querySelectorAll('.titlebar__nav .navitem')].every((n) => !n.disabled)")) === true,
    "",
  );

  await waitFor("document.querySelector('.dock')", "创作表单渲染");
  await js("(() => { document.querySelector('.sidebar .select__trigger')?.click(); return true; })()");
  await sleep(150);
  const modelOptions = await js("[...document.querySelectorAll('.sidebar .select__option')].map((o) => o.textContent)");
  await js("(() => { document.querySelector('.sidebar .select__trigger')?.click(); return true; })()");
  await sleep(120);
  check("模型列表来自 main", modelOptions.some((text) => text && text.includes("Fake Sync 1")), modelOptions);
  // 布局：配置在左侧栏，提示词输入框在右下
  const layout = await js(
    "(() => {" +
      "const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; };" +
      "return { sidebar: box('.sidebar'), dock: box('.dock'), canvas: box('.canvas'), win: [window.innerWidth, window.innerHeight] };" +
      "})()",
  );
  check("左侧是配置栏", layout.sidebar !== null && layout.sidebar.x === 0 && layout.sidebar.w > 200, layout.sidebar);
  check(
    "提示词输入框在右下（画布下方、靠窗口底部）",
    layout.dock !== null && layout.dock.y > layout.sidebar.y + 200 && layout.dock.bottom > layout.win[1] - 12,
    layout.dock,
  );
  check("输入框在右半边", layout.dock !== null && layout.dock.x >= (layout.sidebar?.w ?? 0), layout.dock);
  await shot("01-empty-state");

  // ---- 同步模型 ----
  // 提示词默认为空，先填一句再提交。
  await setPrompt("冒烟：一只在窗边打盹的猫");
  await js("document.querySelector('form.dock button[type=\"submit\"]').click(); true");
  await waitFor("document.querySelector('.result-grid img')", "结果图片出现");
  const resultCount = await js("document.querySelectorAll('.result-grid img').length");
  check("生成结果进入画布", resultCount === 1, resultCount);
  // 图片走 ia-asset:// 自定义协议从磁盘读，而不是 data URL 常驻内存。
  const imageProbe = await js(
    "(() => { const img = document.querySelector('.result-grid img'); return { src: img ? img.currentSrc || img.src : '', w: img ? img.naturalWidth : 0 }; })()",
  );
  check("结果图通过 ia-asset 协议加载", String(imageProbe.src).startsWith("ia-asset://asset/"), imageProbe.src);
  check("图片真的解码出像素", imageProbe.w > 0, imageProbe.w);
  check("作品索引已写盘", fs.existsSync(path.join(USER_DATA, "library.json")), USER_DATA);
  const assetFiles = fs.existsSync(path.join(LIBRARY_DIR, "assets")) ? fs.readdirSync(path.join(LIBRARY_DIR, "assets")) : [];
  check("图片文件已落到作品目录", assetFiles.length >= 1, assetFiles);
  const jobStates = await js("[...document.querySelectorAll('.job-row .status')].map((n) => n.textContent)");
  check("任务栏显示已完成", jobStates.some((text) => text.includes("已完成")), jobStates);
  await shot("02-succeeded");

  await js("document.querySelector('.result-card__button').click(); true");
  await waitFor("document.querySelector('.drawer')", "详情抽屉");
  const drawerText = await js("document.querySelector('.drawer').innerText");
  check("详情显示模型", drawerText.includes("Fake Sync 1"), drawerText.slice(0, 160));
  check("详情显示原始提示词", drawerText.includes("原始提示词"), "");
  check("详情不再出现费用字段", !drawerText.includes("费用"), "");
  await shot("03-drawer");
  await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
  await sleep(200);
  check("Esc 关闭抽屉", !(await js("Boolean(document.querySelector('.drawer'))")), "");

  // ---- 异步模型：生成中 + 取消 ----
  check("切换到异步模型", (await selectModel("Fake Async 1")) === true, "");
  await sleep(200);
  await setPrompt("异步任务取消测试");
  await js("document.querySelector('form.dock button[type=\"submit\"]').click(); true");
  // 主进程若恰好正在建窗口，页面可能被刷新、executeJavaScript 会抛错；waitFor 本身会重试到超时。
  await waitFor("document.querySelector('.active-job')", "异步任务进行中", 15000).catch(async (error) => {
    page = await js("document.body.innerText.slice(0, 600)");
    throw error;
  });
  await sleep(300);
  await shot("04-async-running");
  await waitFor("document.querySelector('.active-job .button--ghost')", "出现停止按钮", 8000);
  await js("document.querySelector('.active-job .button--ghost').click(); true");
  await waitFor("!document.querySelector('.active-job')", "任务离开进行中列表", 8000);
  const cancelled = await js("[...document.querySelectorAll('.job-row .status')].map((n) => n.textContent)");
  check("取消后显示已取消", cancelled.some((text) => text.includes("已取消")), cancelled);
  await shot("05-cancelled");

  // ---- 参考图：已有作品可作为参考图来源 ----
  const referenceOptions = await js("document.querySelectorAll('.sidebar .select').length");
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
  // API 面板要等一次 IPC 回来才渲染出表单，先等到它真的出现。
  await waitFor("document.querySelector('.profile-tabs')", "API 面板渲染");
  const tabs = await js("[...document.querySelectorAll('.settings__tab')].map((n) => n.textContent)");
  check("设置含五个分类", tabs.join(",") === "API 设置,通用设置,存储,数据管理,关于", tabs);
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
  // 保存按钮在弹窗底部（关闭旁边），而不是面板里
  const footButtons = await js("[...document.querySelectorAll('.modal__foot button')].map((n) => n.textContent)");
  check("保存按钮在弹窗底部", footButtons.some((text) => text === "保存" || text === "没有改动"), footButtons);

  // 设置左侧选中态不再是竖条/下划线
  const tabStyle = await js(
    "(() => { const s = getComputedStyle(document.querySelector('.settings__tab.is-active')); return { shadow: s.boxShadow, bg: s.backgroundColor }; })()",
  );
  check("设置左侧选中态是淡填充", tabStyle.shadow === "none" && tabStyle.bg !== "rgba(0, 0, 0, 0)", tabStyle);

  // 输入框旁边也有模型选择
  check("底部输入框旁有模型选择", (await js("Boolean(document.querySelector('.dock .select .select__trigger'))")) === true, "");

  // 手动添加模型：先只有按钮，点了才有输入框；加入后出现提示浮层
  check("默认不显示手动输入框", (await js("!document.querySelector('.settings__body .settings__inline input')")) === true, "");
  await js("(() => { [...document.querySelectorAll('.settings__body button')].find((n) => n.textContent === '添加模型').click(); return true; })()");
  await waitFor("document.querySelector('.settings__body .settings__inline input')", "手动输入框出现");
  check("点击后出现输入框", true, "");
  await js(
    "(() => { const el = document.querySelector('.settings__body .settings__inline input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, 'gpt-image-test'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()",
  );
  await js("(() => { const row = document.querySelector('.settings__body .settings__inline'); [...row.querySelectorAll('button')].find((n) => n.textContent === '保存').click(); return true; })()");
  await sleep(250);
  const chosen = await js("[...document.querySelectorAll('.chosen-models__input')].map((n) => n.value)");
  check("手动添加的模型进入列表", chosen.includes("gpt-image-test"), chosen);
  check("加入后有临时提示浮层", (await js("Boolean(document.querySelector('.settings__toast'))")) === true, "");
  // 模型 id 本身就是输入框：直接改它应该同步到草稿
  await js(
    "(() => { const el = document.querySelector('.chosen-models__input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, 'gpt-image-edited'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()",
  );
  await sleep(150);
  check("已添加的模型可以直接编辑", (await js("document.querySelector('.chosen-models__input')?.value")) === "gpt-image-edited", "");

  // 用本地桩服务走一遍"获取上游模型 → 二级弹窗勾选"
  const stubUrl = process.env.IMAGE_AGENT_STUB_URL;
  if (stubUrl) {
    const fill = (selector, value) =>
      js(
        "(() => { const el = document.querySelector(" +
          JSON.stringify(selector) +
          "); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, " +
          JSON.stringify(value) +
          "); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()",
      );
    await fill('[aria-label="API URL"]', stubUrl);
    await fill('[aria-label="API Key"]', "sk-stub-key");
    await js("(() => { [...document.querySelectorAll('.settings__body button')].find((n) => n.textContent === '获取上游模型').click(); return true; })()");
    // 等请求有个结果：要么弹窗出来，要么有提示浮层说明失败。
    let pickerOpen = false;
    for (let i = 0; i < 100; i += 1) {
      pickerOpen = await js("Boolean(document.querySelector('.picker-modal'))");
      if (pickerOpen) break;
      await sleep(150);
    }
    const toastText = await js("document.querySelector('.settings__toast')?.textContent ?? ''");
    check("获取上游模型请求有结果", pickerOpen || toastText !== "", JSON.stringify({ toastText }));
    if (!pickerOpen) throw new Error("上游模型选择弹窗未出现，提示为：" + toastText);
    const pickerIds = await js("[...document.querySelectorAll('.picker-modal .model-picker__id')].map((n) => n.textContent)");
    check(
      "获取上游模型后弹出二级选择框",
      pickerIds.includes("stub-model-a") && pickerIds.includes("stub-model-b"),
      pickerIds,
    );
    await shot("16-upstream-picker");
    await js("(() => { const m = document.querySelector('.picker-modal'); [...m.querySelectorAll('button')].find((b) => b.textContent === '取消').click(); return true; })()");
    await sleep(200);
    check("取消后选择框关闭", !(await js("Boolean(document.querySelector('.picker-modal'))")), "");
  }

  // 删除入口藏在服务商标签里：默认只显示绿点，悬停才出现垃圾桶
  const deleteUi = await js(
    "(() => { const d = document.querySelector('.profile-tab__delete'); return { exists: Boolean(d), display: d ? getComputedStyle(d).display : null, title: d?.getAttribute('aria-label') ?? '' }; })()",
  );
  check("服务商删除是悬停出现的图标", deleteUi.exists === true && deleteUi.display === "none" && deleteUi.title.includes("删除"), deleteUi);
  const suffixWidth = await js(
    "(() => { const el = document.querySelector('.profile-tab__suffix'); return el ? Math.round(el.getBoundingClientRect().width) : 0; })()",
  );
  check("删图标占用固定宽度（hover 不变宽）", suffixWidth === 20, suffixWidth);

  const profileTabs = await js("document.querySelectorAll('.profile-tab:not(.profile-tab--add)').length");
  check("服务商可以多开", profileTabs >= 1, profileTabs);
  const saved = await js(
    "window.appSettings.save({ profile: { id: 'default', label: '测试服务商', kind: 'openai-compatible', baseUrl: 'https://example.invalid/v1', flavor: 'responses', models: ['gpt-image-2'], stream: true, partialImages: 3, timeoutSeconds: 240 } })",
  );
  check("设置可以保存并重建 provider 表", saved && saved.ok === true, saved);
  const keyState = await js("window.appSettings.view().then((v) => v.keys[v.activeId])");
  check("密钥状态有加密标记字段", keyState !== undefined && typeof keyState.apiKeyEncrypted === "boolean", keyState);
  await shot("08-settings-api");
  await js("(() => { [...document.querySelectorAll('.settings__tab')].find((n) => n.textContent === '通用设置').click(); return true; })()");
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
  await js("(() => { [...document.querySelectorAll('.settings__tab')].find((n) => n.textContent === '存储').click(); return true; })()");
  await sleep(200);
  const storageText = await js("document.querySelector('.settings__body').innerText");
  check("存储页显示保存位置", /作品保存位置/.test(storageText) && /选择文件夹/.test(storageText), storageText.slice(0, 120));
  const storagePath = await js("document.querySelector('.path-box__path')?.textContent ?? ''");
  check("默认目录在 C 盘", /^[A-Z]:\\/.test(storagePath), storagePath);
  await shot("13-settings-storage");
  await js("(() => { [...document.querySelectorAll('.settings__tab')].find((n) => n.textContent === '数据管理').click(); return true; })()");
  await sleep(250);
  const dataText = await js("document.querySelector('.settings__body').innerText");
  check("数据管理含导出/导入/清除", /导出数据/.test(dataText) && /导入数据/.test(dataText) && /清除数据/.test(dataText), dataText.slice(0, 160));
  const dataBoxes = await js("[...document.querySelectorAll('.settings__body .data-selection')].map((n) => n.querySelectorAll('input').length)");
  check("三块各有配置/任务与图片两个选项", JSON.stringify(dataBoxes) === JSON.stringify([2, 2, 2]), dataBoxes);
  const summary = await js("window.appData.summary()");
  check("数据摘要可读", summary !== undefined && typeof summary.jobs === "number", summary);
  await shot("15-settings-data");
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
  await js("(() => { [...document.querySelectorAll('.navitem')].find((n) => n.textContent.includes('创作')).click(); return true; })()");
  await waitFor("document.querySelector('.dock')", "回到创作页");

  // ---- 模型参数：箭头展开后显示能力/尺寸/格式 ----
  await js("document.querySelector('.titlebar__icon').click(); true");
  await waitFor("document.querySelector('.profile-tabs')", "API 面板");
  const hasDetailToggle = await js("Boolean(document.querySelector('.chosen-models__detail-toggle'))");
  if (hasDetailToggle) {
    await js("document.querySelector('.chosen-models__detail-toggle').click(); true");
    await sleep(200);
    const details = await js("document.querySelector('.chosen-models__details')?.innerText ?? ''");
    check("模型参数可以展开", /能力/.test(details) && /尺寸/.test(details), details.slice(0, 80));
    check("删除是垃圾桶图标", (await js("Boolean(document.querySelector('.chosen-models__remove svg'))")) === true, "");
  }
  await js("(() => { [...document.querySelectorAll('.settings__tab')].find((n) => n.textContent === '通用设置').click(); return true; })()");
  await sleep(200);
  const langSelect = await js(
    "(() => { const s = [...document.querySelectorAll('.settings__body .select__trigger')].map((n) => n.textContent); return s; })()",
  );
  check("通用设置有语言选择", langSelect.some((text) => text.includes("简体中文")), langSelect);
  await js("(() => { [...document.querySelectorAll('.settings__tab')].find((n) => n.textContent === 'API 设置').click(); return true; })()");
  await sleep(150);
  await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
  await sleep(200);

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
modelsStub.close();

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
