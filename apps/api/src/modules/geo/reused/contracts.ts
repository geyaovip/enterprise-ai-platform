// Copied from yingchuan-formal-ui f52ca56 (read-only source), 2026-11-07.
export const ANALYSIS_OUTPUT_TOKEN_LIMIT = 2048;

export type ModelGatewayErrorCategory =
  | "authentication"
  | "rate_limit"
  | "provider_unavailable"
  | "policy_rejection"
  | "timeout"
  | "invalid_response"
  | "unknown";

export interface ModelGatewayRequest {
  readonly apiMode: "responses" | "chat_completions";
  readonly modelCode: string;
  readonly maxOutputTokens?: number;
  readonly prompt: string;
  readonly requestId: string;
  readonly timeoutMs: number;
  readonly nativeWebSearch?: {
    readonly enabled: true;
    readonly toolConfig: Readonly<Record<string, unknown>>;
    readonly toolVersion: string;
  };
}

export interface ModelGatewayCitation {
  readonly title?: string;
  readonly url: string;
}

export interface ModelGatewayResponse {
  readonly searchCalls?: number;
  readonly citations: readonly ModelGatewayCitation[];
  readonly finishReason?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly providerRequestId?: string;
  readonly text: string;
}

export interface ModelProviderAdapter {
  invoke(
    request: ModelGatewayRequest,
    credential: string,
  ): Promise<ModelGatewayResponse>;
}

export class ModelGatewayError extends Error {
  constructor(
    readonly category: ModelGatewayErrorCategory,
    readonly code: string,
    readonly retryable: boolean,
    message = code,
  ) {
    super(message);
    this.name = "ModelGatewayError";
  }
}
