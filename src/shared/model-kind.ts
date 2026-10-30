/**
 * 模型类型判定：上游 `/models` 不区分类别，只能靠名字猜 + 人工改。
 *
 * 猜错的代价很具体：把对话模型加进图片服务商，创作页会出现它，选中后一定出图失败；
 * 反过来把图片模型加进语言模型，Agent 优化也会被上游拒绝。
 */
export type ModelKind = "image" | "text" | "unknown";

const IMAGE_HINTS = [
  "image",
  "dall-e",
  "dalle",
  "flux",
  "sdxl",
  "stable-diffusion",
  "sd3",
  "sd-",
  "midjourney",
  "seedream",
  "seededit",
  "imagen",
  "kolors",
  "wanx",
  "cogview",
  "janus",
  "ideogram",
  "recraft",
  "grok-2-image",
  "qwen-image",
  "nano-banana",
];

const TEXT_HINTS = [
  "gpt-4",
  "gpt-3",
  "gpt-5",
  "o1",
  "o3",
  "o4",
  "claude",
  "deepseek",
  "glm",
  "kimi",
  "moonshot",
  "qwen",
  "llama",
  "mistral",
  "yi-",
  "gemini",
  "chat",
  "instruct",
  "nemotron",
  "command",
  "doubao",
  "ernie",
  "hunyuan",
  "spark",
  "whisper",
  "embed",
];

export function guessModelKind(id: string): ModelKind {
  const name = id.toLowerCase();
  // 先看图片线索：像 gpt-image-1 这种同时命中 "gpt" 与 "image" 的，必须判成图片。
  if (IMAGE_HINTS.some((hint) => name.includes(hint))) return "image";
  if (TEXT_HINTS.some((hint) => name.includes(hint))) return "text";
  return "unknown";
}

/** 该类型能不能用在某个用途上：未知一律放行，由用户自己决定。 */
export function modelFitsPurpose(kind: ModelKind | undefined, purpose: "image" | "text"): boolean {
  if (kind === undefined || kind === "unknown") return true;
  return kind === purpose;
}
