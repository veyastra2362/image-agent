/**
 * 本地外观偏好：只存主题（跟随系统 / 白天 / 黑夜）与密度，不放任何密钥或提示词。
 */
export type ThemePreference = "auto" | "light" | "dark";
export type DensityPreference = "comfortable" | "compact";
export type FontPreference = "system" | "serif" | "mono";
export type LanguagePreference = "zh" | "en";

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
}

const DEFAULT: Appearance = {
  theme: "auto",
  density: "comfortable",
  sidebarCollapsed: false,
  fontSize: FONT_SIZE_RANGE.default,
  fontFamily: "system",
  language: "zh",
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
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  if (appearance.theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = appearance.theme;
  root.dataset.density = appearance.density;

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

function parseFont(raw: unknown): FontPreference {
  return raw === "serif" || raw === "mono" ? raw : "system";
}
