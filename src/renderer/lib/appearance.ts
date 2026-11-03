/**
 * 本地外观偏好：只存主题（跟随系统 / 白天 / 黑夜）与密度，不放任何密钥或提示词。
 */
export type ThemePreference = "auto" | "light" | "dark";
export type DensityPreference = "comfortable" | "compact";
export type FontPreference = "system" | "serif" | "mono";
export type LanguagePreference = "zh" | "en";
/** 主界面一次显示几行结果（1~3），超出部分折叠。 */
export type ResultRowsPreference = 1 | 2 | 3;
export const RESULT_ROWS_RANGE = { min: 1, max: 3, default: 2 } as const;

/** 配色方案：石墨蓝 / 素墨 / 冷灰苔绿。 */
export type PalettePreference = "graphite" | "ink" | "sage";

export const PALETTE_OPTIONS: readonly {
  readonly value: PalettePreference;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: "graphite", label: "石墨蓝", hint: "冷灰底 + 钢蓝强调，偏技术感" },
  { value: "ink", label: "素墨", hint: "纯中性灰，强调色即墨色，最克制" },
  { value: "sage", label: "冷灰苔绿", hint: "冷灰 + 苔绿，柔和耐看" },
];

export const FONT_OPTIONS: readonly { readonly value: FontPreference; readonly label: string; readonly stack: string }[] = [
  {
    value: "system",
    label: "系统默认",
    stack: '"Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  { value: "serif", label: "衬线（宋体）", stack: '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, serif' },
  { value: "mono", label: "等宽", stack: '"Cascadia Mono", "Cascadia Code", "Sarasa Mono SC", Consolas, monospace' },
];

export const FONT_SIZE_RANGE = { min: 12, max: 18, default: 14 } as const;

const KEY = "image-agent:appearance:v1";

export interface Appearance {
  readonly theme: ThemePreference;
  readonly density: DensityPreference;
  /** 创作页左侧配置栏是否收起；记住它，下次打开保持。 */
  readonly sidebarCollapsed: boolean;
  /** 界面字号（px）。 */
  readonly fontSize: number;
  readonly fontFamily: FontPreference;
  /** 界面语言。 */
  readonly language: LanguagePreference;
  /** 配色方案。 */
  readonly palette: PalettePreference;
  /** 结果区默认显示几行（1~3）。 */
  readonly resultRows: ResultRowsPreference;
}

const DEFAULT: Appearance = {
  theme: "auto",
  density: "comfortable",
  sidebarCollapsed: false,
  fontSize: FONT_SIZE_RANGE.default,
  fontFamily: "system",
  language: "zh",
  palette: "graphite",
  resultRows: RESULT_ROWS_RANGE.default,
};

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT;
    const theme = (parsed as { theme?: unknown }).theme;
    const density = (parsed as { density?: unknown }).density;
    return {
      theme: theme === "light" || theme === "dark" ? theme : "auto",
      density: density === "compact" ? "compact" : "comfortable",
      sidebarCollapsed: (parsed as { sidebarCollapsed?: unknown }).sidebarCollapsed === true,
      fontSize: clampFontSize((parsed as { fontSize?: unknown }).fontSize),
      fontFamily: parseFont((parsed as { fontFamily?: unknown }).fontFamily),
      language: (parsed as { language?: unknown }).language === "en" ? "en" : "zh",
      palette: parsePalette((parsed as { palette?: unknown }).palette),
      resultRows: parseResultRows((parsed as { resultRows?: unknown }).resultRows),
    };
  } catch {
    return DEFAULT;
  }
}

export function saveAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance));
  } catch {
    // 存储被禁用时静默降级：外观记忆不是核心功能。
  }
}

/**
 * 把偏好写到 <html> 的 data 属性上，样式表据此切换。
 *
 * "跟随系统"不留 data-theme：样式表用 prefers-color-scheme 判断，
 * 系统主题一变界面立刻跟着变，不需要应用重启或重新渲染。
 */
/** 结果行数只接受 1~3 的整数，其他值回落到默认。 */
export function parseResultRows(value: unknown): ResultRowsPreference {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return RESULT_ROWS_RANGE.default;
  const rounded = Math.round(parsed);
  if (rounded < RESULT_ROWS_RANGE.min) return RESULT_ROWS_RANGE.min;
  if (rounded > RESULT_ROWS_RANGE.max) return RESULT_ROWS_RANGE.max;
  return rounded as ResultRowsPreference;
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  if (appearance.theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = appearance.theme;
  root.dataset.density = appearance.density;
  root.dataset.palette = appearance.palette;

  // 字号：以 --fs-md 为基准等比缩放其余档位，避免只改一处导致层级错乱。
  const base = clampFontSize(appearance.fontSize);
  const set = (name: string, value: number) => root.style.setProperty(name, `${Math.round(value)}px`);
  set("--fs-xs", base * 0.79);
  set("--fs-sm", base * 0.86);
  set("--fs-md", base);
  set("--fs-lg", base * 1.14);
  set("--fs-xl", base * 1.29);

  const stack = FONT_OPTIONS.find((option) => option.value === appearance.fontFamily)?.stack ?? FONT_OPTIONS[0]?.stack;
  if (stack !== undefined) root.style.setProperty("--font-ui", stack);
}

function clampFontSize(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return FONT_SIZE_RANGE.default;
  return Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, Math.round(raw)));
}

function parsePalette(raw: unknown): PalettePreference {
  return raw === "ink" || raw === "sage" ? raw : "graphite";
}

function parseFont(raw: unknown): FontPreference {
  return raw === "serif" || raw === "mono" ? raw : "system";
}
