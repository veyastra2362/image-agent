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
      <rect x="1.8" y="1.8" width="6.4" height="6.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
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
  // 14px 下齿轮的齿容易糊成一团，用"滑杆"表示设置更清晰。
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
      <circle cx="6" cy="4.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10.5" cy="8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5" cy="11.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}