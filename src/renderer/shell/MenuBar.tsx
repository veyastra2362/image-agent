/**
 * 顶部菜单：应用 / 编辑。
 *
 * 系统菜单被去掉了（Menu.setApplicationMenu(null)），所以这里自绘：
 *  - 编辑动作交给 main 的 webContents 执行，才能作用在当前聚焦的输入框上
 *  - 菜单本身是普通渲染层 DOM，样式与主题一致
 */
import { useEffect, useRef, useState } from "react";
import type { EditAction } from "../../shared/app-shell.ts";
import { useT } from "../lib/i18n.ts";

type MenuId = "app" | "edit";

interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly action: () => void;
  readonly separatorBefore?: boolean;
  readonly disabled?: boolean;
}

export interface MenuBarProps {
  readonly onOpenSettings: () => void;
  readonly onOpenLibraryFolder: () => void;
  readonly onQuit: () => void;
}

export function MenuBar({ onOpenSettings, onOpenLibraryFolder, onQuit }: MenuBarProps) {
  const t = useT();
  const [open, setOpen] = useState<MenuId>();
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === undefined) return;
    const onDown = (event: MouseEvent) => {
      if (barRef.current?.contains(event.target as Node) !== true) setOpen(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(undefined);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Ctrl+, 打开设置：和菜单里写的快捷键一致。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        onOpenSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenSettings]);

  const runEdit = (action: EditAction) => {
    void window.appInfo?.edit(action);
    setOpen(undefined);
  };

  const menus: readonly { id: MenuId; label: string; items: readonly MenuItem[] }[] = [
    {
      id: "app",
      label: t("app.file"),
      items: [
        { id: "settings", label: t("menu.settings"), shortcut: "Ctrl+,", action: () => { onOpenSettings(); setOpen(undefined); } },
        { id: "folder", label: t("menu.openLibrary"), action: () => { onOpenLibraryFolder(); setOpen(undefined); }, separatorBefore: true },
        { id: "quit", label: t("menu.quit"), shortcut: "Alt+F4", action: onQuit, separatorBefore: true },
      ],
    },
    {
      id: "edit",
      label: t("app.edit"),
      items: [
        { id: "undo", label: t("menu.undo"), shortcut: "Ctrl+Z", action: () => runEdit("undo") },
        { id: "redo", label: t("menu.redo"), shortcut: "Ctrl+Y", action: () => runEdit("redo") },
        { id: "cut", label: t("menu.cut"), shortcut: "Ctrl+X", action: () => runEdit("cut"), separatorBefore: true },
        { id: "copy", label: t("menu.copy"), shortcut: "Ctrl+C", action: () => runEdit("copy") },
        { id: "paste", label: t("menu.paste"), shortcut: "Ctrl+V", action: () => runEdit("paste") },
        { id: "delete", label: t("menu.delete"), shortcut: "Del", action: () => runEdit("delete") },
        { id: "selectAll", label: t("menu.selectAll"), shortcut: "Ctrl+A", action: () => runEdit("selectAll"), separatorBefore: true },
      ],
    },
  ];

  return (
    <div className="menubar" ref={barRef}>
      {menus.map((menu) => (
        <div className="menubar__root" key={menu.id}>
          <button
            type="button"
            className={`menubar__button ${open === menu.id ? "is-open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={open === menu.id}
            onClick={() => setOpen(open === menu.id ? undefined : menu.id)}
            // 已经有菜单展开时，悬停即可切换，和常见桌面菜单一致。
            onMouseEnter={() => {
              if (open !== undefined) setOpen(menu.id);
            }}
          >
            {menu.label}
          </button>

          {open === menu.id && (
            <div className="menu" role="menu" aria-label={menu.label}>
              {menu.items.map((item) => (
                <div key={item.id}>
                  {item.separatorBefore === true && <div className="menu__separator" role="separator" />}
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__item"
                    disabled={item.disabled === true}
                    onClick={item.action}
                  >
                    <span>{item.label}</span>
                    {item.shortcut !== undefined && <span className="menu__shortcut">{item.shortcut}</span>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
