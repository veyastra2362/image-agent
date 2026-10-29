/**
 * 极简 i18n：只有中文与英文两套词条。
 *
 * 目前的覆盖范围是应用外壳与设置框架（菜单、导航、设置分类、通用设置、底部输入框）。
 * 没有用任何 i18n 库：词条量还很小，引入库反而要处理插值、复数、命名空间，
 * 等真正需要时再换。
 */
import { useSyncExternalStore } from "react";

export type Lang = "zh" | "en";

export const LANGUAGES: readonly { readonly value: Lang; readonly label: string }[] = [
  { value: "zh", label: "简体中文" },
  { value: "en", label: "English" },
];

const zh = {
  "app.edit": "编辑",
  "app.file": "应用",
  "menu.settings": "设置…",
  "menu.openLibrary": "打开作品文件夹",
  "menu.quit": "退出",
  "menu.undo": "撤销",
  "menu.redo": "重做",
  "menu.cut": "剪切",
  "menu.copy": "复制",
  "menu.paste": "粘贴",
  "menu.delete": "删除",
  "menu.selectAll": "全选",
  "nav.create": "创作",
  "nav.library": "作品库",
  "settings.title": "设置",
  "settings.tab.api": "API 设置",
  "settings.tab.general": "通用设置",
  "settings.tab.storage": "存储",
  "settings.tab.data": "数据管理",
  "settings.tab.about": "关于",
  "settings.save": "保存",
  "settings.saving": "保存中…",
  "settings.close": "关闭",
  "settings.reload": "重新读取",
  "general.theme": "主题",
  "general.theme.auto": "跟随系统",
  "general.theme.light": "白天",
  "general.theme.dark": "黑夜",
  "general.density": "密度",
  "general.density.comfortable": "宽松",
  "general.density.compact": "紧凑",
  "general.fontSize": "字号大小",
  "general.fontSizeHint": "影响界面文字的基准大小，12–18 px",
  "general.font": "字体",
  "general.language": "语言",
  "general.languageHint": "选择界面语言。英文目前覆盖外壳与设置框架。",
  "general.themeHint": "「跟随系统」会随操作系统的浅色/深色设置自动切换。外观只保存在本机，不影响生成结果。",
  "dock.generate": "生成",
  "dock.generating": "提交中…",
  "dock.noModel": "没有可用模型",
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  "app.edit": "Edit",
  "app.file": "App",
  "menu.settings": "Settings…",
  "menu.openLibrary": "Open library folder",
  "menu.quit": "Quit",
  "menu.undo": "Undo",
  "menu.redo": "Redo",
  "menu.cut": "Cut",
  "menu.copy": "Copy",
  "menu.paste": "Paste",
  "menu.delete": "Delete",
  "menu.selectAll": "Select all",
  "nav.create": "Create",
  "nav.library": "Library",
  "settings.title": "Settings",
  "settings.tab.api": "API",
  "settings.tab.general": "General",
  "settings.tab.storage": "Storage",
  "settings.tab.data": "Data",
  "settings.tab.about": "About",
  "settings.save": "Save",
  "settings.saving": "Saving…",
  "settings.close": "Close",
  "settings.reload": "Reload",
  "general.theme": "Theme",
  "general.theme.auto": "System",
  "general.theme.light": "Light",
  "general.theme.dark": "Dark",
  "general.density": "Density",
  "general.density.comfortable": "Comfortable",
  "general.density.compact": "Compact",
  "general.fontSize": "Font size",
  "general.fontSizeHint": "Base size for UI text, 12–18 px",
  "general.font": "Font",
  "general.language": "Language",
  "general.languageHint": "UI language. English currently covers the shell and settings framework.",
  "general.themeHint":
    "\"System\" follows the OS light/dark setting. Appearance is stored locally and never affects generation.",
  "dock.generate": "Generate",
  "dock.generating": "Submitting…",
  "dock.noModel": "No model",
};

const DICTIONARIES: Record<Lang, Record<Key, string>> = { zh, en };

let current: Lang = "zh";
const listeners = new Set<() => void>();

export function setLang(lang: Lang): void {
  if (current === lang) return;
  current = lang;
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  for (const listener of listeners) listener();
}

export function getLang(): Lang {
  return current;
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLang,
    getLang,
  );
}

export function translate(key: Key, lang: Lang = current): string {
  return DICTIONARIES[lang][key] ?? zh[key];
}

/** 组件里用：const t = useT(); t("nav.create") */
export function useT(): (key: Key) => string {
  const lang = useLang();
  return (key: Key) => translate(key, lang);
}

export type I18nKey = Key;
