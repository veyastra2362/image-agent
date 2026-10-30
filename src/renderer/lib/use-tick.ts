/**
 * 每秒刷新的时间戳。
 *
 * 用于"已等待 N 秒"这类文案：只在有进行中的任务时启用，任务结束后不再空转。
 */
import { useEffect, useState } from "react";

export function useTick(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);

  return now;
}

/** 把毫秒数说成人话：42 秒 / 1 分 17 秒。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes} 分 ${seconds} 秒`;
}
