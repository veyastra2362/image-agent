/**
 * "从列表移除"的任务 id：只影响界面显示，作品文件与索引都不动。
 *
 * 存在本机 localStorage；导出备份时会被一起带走（见数据管理），
 * 这样换台机器/重装以后移除状态也还在。
 */
const HIDDEN_JOBS_KEY = "image-agent:hidden-jobs:v1";

export function loadHiddenJobs(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_JOBS_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id !== ""));
  } catch {
    return new Set();
  }
}

export function saveHiddenJobs(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(HIDDEN_JOBS_KEY, JSON.stringify([...ids]));
  } catch {
    // 存储不可用时静默降级：只是"移除"不会记住而已。
  }
}

/** 导入备份后用它整体替换。 */
export function replaceHiddenJobs(ids: readonly string[]): void {
  saveHiddenJobs(new Set(ids.filter((id) => typeof id === "string" && id !== "")));
}
