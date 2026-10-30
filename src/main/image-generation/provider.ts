/**
 * Provider 合约：每个厂商的请求/响应格式只留在自己的 adapter 里。
 *
 * 能力是模型级的（`getCapabilities(model)`），不是 provider 级；
 * 可选模型列表来自 provider 自己，main 不猜测"看起来相似"的模型。
 */
import type { AspectRatio, ImageCapabilities, ImageError, SizeMode } from "@shared/image-generation";

export interface ProviderModel {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ImageCapabilities;
}

export interface ProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly defaultModel: string;
  readonly models: readonly ProviderModel[];
  /** 参考图是否需要上传给远端服务。本地 provider 为 false。 */
  readonly uploadsUserAssets: boolean;
  /** 用于改写提示词的 chat 模型；没配就表示不能做 Agent 优化。 */
}

export interface ProviderGenerateRequest {
  readonly model: string;
  readonly prompt: string;
  readonly referenceAssetIds: readonly string[];
  /** 参考图的原始字节；main 从作品库读出来交给 adapter，adapter 不需要认识 asset ID。 */
  readonly referenceImages?: readonly { readonly bytes: Uint8Array; readonly mimeType: string }[];
  readonly aspectRatio: AspectRatio;
  readonly count: number;
  readonly seed?: number;
  readonly negativePrompt?: string;
  /** "auto" 时不指定尺寸，交给上游自己决定。 */
  readonly sizeMode?: SizeMode;
  /** 由 main 推导好的最终宽高；auto 时省略。 */
  readonly size?: { readonly width: number; readonly height: number };
  /** 流式 provider 收到中间步骤图像时回调（只用于进度展示，不入库）。 */
  readonly onPartialImage?: (hit: { readonly index: number; readonly bytes: Uint8Array }) => void;
}

export interface ProviderImage {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export type ProviderSubmitResult =
  | {
      readonly state: "completed";
      readonly images: readonly ProviderImage[];
    }
  | {
      readonly state: "running";
      readonly remoteTaskId: string;
      readonly pollAfterMs: number;
    };

export type ProviderPollResult =
  | { readonly state: "running"; readonly pollAfterMs: number }
  | { readonly state: "completed"; readonly images: readonly ProviderImage[] }
  | { readonly state: "failed"; readonly error: ImageError }
  | { readonly state: "cancelled" };

/** provider 抛出的结构化错误：service 直接采用它的 code/retryable，而不是一律当成内部错误。 */
export interface ProviderRequestError extends Error {
  readonly detail: ImageError;
}

export function isProviderRequestError(error: unknown): error is ProviderRequestError {
  return (
    error instanceof Error &&
    "detail" in error &&
    typeof (error as { detail?: unknown }).detail === "object" &&
    (error as { detail?: unknown }).detail !== null
  );
}

export interface ImageProvider {
  readonly descriptor: ProviderDescriptor;
  getModel(model: string): ProviderModel | undefined;
  getCapabilities(model: string): ImageCapabilities | undefined;
  submit(request: ProviderGenerateRequest, signal: AbortSignal): Promise<ProviderSubmitResult>;
  /** 只有 `capabilities.async` 为 true 时才调用。 */
  poll(remoteTaskId: string, signal: AbortSignal): Promise<ProviderPollResult>;
  /** 只有 `capabilities.cancel` 为 true 时才调用；返回上游是否确认已停止。 */
  cancel(remoteTaskId: string): Promise<boolean>;
}
