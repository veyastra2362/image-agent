/**
 * Agent Planner 的结构化结果：`ImagePlan`。
 *
 * 语言模型只被允许产出这一份 JSON；main 负责校验，非法内容一律拒绝，
 * 绝不把模型给的自由文本直接当成请求参数。
 */
import { LIMITS, PRESET_RATIOS, type AspectRatio } from "./image-generation";

export interface ImagePlan {
  /** 精炼后可用的提示词。 */
  readonly prompt: string;
  readonly negativePrompt?: string;
  /** 建议比例；只能是预设之一。 */
  readonly aspectRatio?: AspectRatio;
  /** 建议张数。 */
  readonly count?: number;
  /** 给用户看的推荐理由（不参与出图）。 */
  readonly reasoning?: string;
  /** 还需要用户澄清的问题；有内容时界面应提示，而不是直接出图。 */
  readonly questions?: readonly string[];
}

export type PlanResult =
  | { readonly ok: true; readonly plan: ImagePlan }
  | { readonly ok: false; readonly error: string };

const MAX_PROMPT = 2000;
const MAX_REASONING = 400;

/** 从模型回复里挑出 JSON：容忍 ```json 代码块和前后废话。 */
export function extractJsonBlock(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  return candidate.slice(start, end + 1);
}

export function validateImagePlan(raw: unknown): PlanResult {
  let parsed = raw;
  if (typeof raw === "string") {
    const block = extractJsonBlock(raw);
    if (block === undefined) return { ok: false, error: "模型没有返回 JSON" };
    try {
      parsed = JSON.parse(block);
    } catch {
      return { ok: false, error: "模型返回的 JSON 无法解析" };
    }
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, error: "计划格式不正确" };

  const record = parsed as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (prompt === "") return { ok: false, error: "计划里没有提示词" };
  if (prompt.length > MAX_PROMPT) return { ok: false, error: `提示词不能超过 ${MAX_PROMPT} 字` };

  const negativePrompt =
    typeof record.negativePrompt === "string" && record.negativePrompt.trim() !== ""
      ? record.negativePrompt.trim().slice(0, LIMITS.negativePromptMaxLength)
      : undefined;

  const ratioRaw = record.aspectRatio;
  const aspectRatio =
    typeof ratioRaw === "string" && (PRESET_RATIOS as readonly string[]).includes(ratioRaw)
      ? (ratioRaw as AspectRatio)
      : undefined;

  const countRaw = record.count;
  const count =
    typeof countRaw === "number" && Number.isInteger(countRaw) && countRaw >= 1 && countRaw <= LIMITS.maxOutputCount
      ? countRaw
      : undefined;

  const reasoning =
    typeof record.reasoning === "string" && record.reasoning.trim() !== ""
      ? record.reasoning.trim().slice(0, MAX_REASONING)
      : undefined;

  const questions = Array.isArray(record.questions)
    ? record.questions
        .filter((item): item is string => typeof item === "string" && item.trim() !== "")
        .map((item) => item.trim().slice(0, 200))
        .slice(0, 3)
    : [];

  return {
    ok: true,
    plan: {
      prompt,
      ...(negativePrompt === undefined ? {} : { negativePrompt }),
      ...(aspectRatio === undefined ? {} : { aspectRatio }),
      ...(count === undefined ? {} : { count }),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(questions.length === 0 ? {} : { questions }),
    },
  };
}
