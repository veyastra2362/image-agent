/**
 * 侧栏开关图标：细线框的"左栏"语义（panel-left）。
 *
 * 项目没有图标库，为一个图标引依赖不划算，这里用内联 SVG：
 * 16×16、currentColor、1.1 的描边，和外框留 1.75 的留白，
 * 视觉上接近桌面应用的紧凑图标而不是网页图标。
 */
export interface PanelLeftIconProps {
  readonly size?: number;
}

export function PanelLeftIcon({ size = 16 }: PanelLeftIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M6.25 3.25v9.5" />
    </svg>
  );
}
