/**
 * 上游探测：拉模型列表、试一次连通性。
 *
 * 这是应用里唯一"用户点一下就会拿密钥去发请求"的地方，所以刻意做得很窄：
 *  - 只有一个方法，URL 由已校验的 baseUrl 拼出，不接受任意路径
 *  - 有超时，不会无限挂着
 *  - 错误文案里绝不回显密钥；Authorization 头只在出站时存在
 *
 * 两类服务商的差异（都是公开文档里的形状，没在这里做兼容层）：
 *  - OpenAI 兼容：GET {base}/models → { data: [{ id, owned_by }] }
 *  - fal.ai：官方没有"列出全部模型"的端点，模型是按 app id（如 fal-ai/flux/dev）寻址的，
 *    所以"获取上游模型"在本应用里只对 OpenAI 兼容接口提供；fal 走手动填写 ID。
 */
import type { ModelFetchResult, ProviderKind, UpstreamModel } from "@shared/provider-settings";

const MAX_BODY_CHARS = 512 * 1024;

export interface ProbeOptions {
  readonly kind: ProviderKind;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  /** 测试注入。 */
  readonly fetchImpl?: typeof fetch;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function modelsUrl(baseUrl: string): string {
  return `${stripTrailingSlash(baseUrl)}/models`;
}

/** 从各种形状里尽量捞出模型 id；认不出来就返回空数组，由调用方报错。 */
export function parseModelsPayload(payload: unknown): UpstreamModel[] {
  const list = (() => {
    if (Array.isArray(payload)) return payload;
    if (typeof payload !== "object" || payload === null) return [];
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "models", "items", "result"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
    return [];
  })();

  const models: UpstreamModel[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (typeof entry === "string") {
      if (!seen.has(entry)) {
        seen.add(entry);
        models.push({ id: entry });
      }
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = [record.id, record.name, record.model, record.slug].find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "",
    );
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const displayName =
      typeof record.display_name === "string"
        ? record.display_name
        : typeof record.displayName === "string"
          ? record.displayName
          : undefined;
    models.push({ id, ...(displayName === undefined ? {} : { displayName }) });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

async function readBody(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text;
}

/** 把上游错误正文压成一句人话；截断且只取 message 类字段，避免把整段响应回显。 */
export function describeHttpFailure(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const error = record.error;
      const message =
        typeof error === "string"
          ? error
          : typeof error === "object" && error !== null && typeof (error as Record<string, unknown>).message === "string"
            ? String((error as Record<string, unknown>).message)
            : typeof record.message === "string"
              ? record.message
              : undefined;
      if (message !== undefined) detail = message;
    }
  } catch {
    // 不是 JSON，就用原文。
  }
  detail = detail.replace(/\s+/g, " ").slice(0, 200);
  const hint =
    status === 401 || status === 403
      ? "（密钥无效或没有权限）"
      : status === 404
        ? "（地址或路径不对，检查 API URL 是否需要带 /v1）"
        : status === 429
          ? "（被限流了，稍后再试）"
          : "";
  return `HTTP ${status}${hint}：${detail === "" ? "无响应正文" : detail}`;
}

export async function fetchUpstreamModels(options: ProbeOptions): Promise<ModelFetchResult> {
  if (options.kind === "fal") {
    return {
      ok: false,
      error: "fal.ai 没有“列出全部模型”的接口，模型按 app id（例如 fal-ai/flux/dev）寻址，请在下方手动填写模型 ID。",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    const response = await fetchImpl(modelsUrl(options.baseUrl), {
      method: "GET",
      headers: { authorization: `Bearer ${options.apiKey}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: describeHttpFailure(response.status, await readBody(response)) };
    }
    const models = parseModelsPayload(JSON.parse(await readBody(response)) as unknown);
    if (models.length === 0) return { ok: false, error: "上游返回了空的模型列表" };
    return { ok: true, models };
  } catch (error) {
    return { ok: false, error: describeNetworkFailure(error, controller.signal) };
  } finally {
    clearTimeout(timeout);
  }
}

/** 网络层失败的统一文案；超时要单独说清楚，否则用户只会看到 "fetch failed"。 */
export function describeNetworkFailure(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted === true) return "请求超时：上游在限定时间内没有响应";
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  const code = cause?.code;
  const hint =
    code === "ENOTFOUND"
      ? "域名解析失败"
      : code === "ECONNREFUSED"
        ? "连接被拒绝"
        : code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
          ? "证书校验失败"
          : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return [hint, message !== "" ? `（${message.slice(0, 120)}）` : ""].filter(Boolean).join("") || "请求失败";
}
