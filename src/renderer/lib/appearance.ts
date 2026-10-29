/**
 * 本地外观偏好：只存主题与密度，不放任何密钥或提示词。
 */
export type ThemePreference = "auto" | "light" | "dark";
export type DensityPreference = "comfortable" | "compact";

const KEY = "image-agent:appearance:v1";

export interface Appearance {
  readonly theme: ThemePreference;
  readonly density: DensityPreference;
}

const DEFAULT: Appearance = { theme: "auto", density: "comfortable" };

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

/** 把偏好写到 <html> 的 data 属性上，样式表据此切换。 */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = appearance.theme;
  root.dataset.density = appearance.density;
}
