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
/** 上传参考图：图片 + 加号。 */
export function ImagePlusIcon({ size = 14 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.8" y="2.6" width="9.4" height="8.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2.4 9.4 5.7 6.4l2.4 2.2 1.6-1.3 1.5 1.3" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 9.4v4.2M10.9 11.5h4.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 外观：太阳 / 月亮 / 显示器 / 行距。 */
export function SunIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function MoonIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13 9.6A5.4 5.4 0 0 1 6.4 3a5.4 5.4 0 1 0 6.6 6.6Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function MonitorIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.8" y="3" width="12.4" height="8" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 13.2h4M8 11v2.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function RowsIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function RowsCompactIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2.5 5.5h11M2.5 8.2h11M2.5 10.9h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 收藏：实心/描边两种状态。 */
export function HeartIcon({ size = 14, filled = false }: { readonly size?: number; readonly filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 13.4 3.4 9a2.9 2.9 0 0 1 4.1-4.1l.5.5.5-.5A2.9 2.9 0 0 1 12.6 9Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 一键优化：小星形，表示"让模型改写"。 */
export function SparkIcon({ size = 14 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 1.6 9.4 6l4.4 1.4L9.4 8.8 8 13.2 6.6 8.8 2.2 7.4 6.6 6Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** 优化并直接发送：星形 + 箭头，表示"改写后立刻出图"。 */
export function SparkSendIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6.4 1.8 7.4 5l3.2 1-3.2 1-1 3.2-1-3.2L2.2 6l3.2-1Z" fill="currentColor" />
      <path d="M11.6 8.4v4.4M11.6 12.8 9.9 11M11.6 12.8 13.3 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 发送/生成：纸飞机。 */
export function SendIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M2 8 14 2.4 9.6 14l-2-4.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 重试：环形箭头。 */
export function RetryIcon({ size = 14 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M13 8a5 5 0 1 1-1.6-3.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M13.4 2.6v3.2h-3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
