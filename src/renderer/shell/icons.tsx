/**
 * 小的内联图标。项目没有图标库，为一个图形引依赖不划算。
 * 统一 16×16、currentColor、细线框。
 */

export function TrashIcon({ size = 12 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3 4.5h10M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M5 4.5l.6 8a1 1 0 0 0 1 .95h3.8a1 1 0 0 0 1-.95l.6-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronIcon({ size = 12, open = false }: { readonly size?: number; readonly open?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }}
    >
      <path d="M6.5 4 10.5 8 6.5 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 窗口控制图标：10×10 细线，居中由 flex 保证。 */
export function MinimizeIcon({ size = 10 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d="M2 5h6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function MaximizeIcon({ size = 10 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function RestoreIcon({ size = 10 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3.5 8.5h4a1 1 0 0 0 1-1v-4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon({ size = 10 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d="M2.5 2.5 7.5 7.5M7.5 2.5 2.5 7.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function GearIcon({ size = 14 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}
