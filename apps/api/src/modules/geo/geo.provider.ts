import { Injectable } from "@nestjs/common";
import { VolcengineArkAdapter } from "./reused/ark-adapter";
import {
  ModelGatewayError,
  type ModelGatewayResponse,
} from "./reused/contracts";
import { infrastructureSecret } from "../platform/infrastructure-contract";
import {
  OUTPUT_LIMIT,
  type FrozenInput,
  type FrozenModel,
  type FrozenQuestion,
  promptText,
} from "./geo.rules";
@Injectable()
export class GeoProvider {
  private readonly adapter = new VolcengineArkAdapter();
  async invoke(
    model: FrozenModel,
    question: FrozenQuestion,
    snapshot: FrozenInput,
    ciphertext: string,
    requestId: string,
  ): Promise<ModelGatewayResponse> {
    const result = await this.adapter.invoke(
      {
        apiMode: model.apiMode,
        modelCode: model.code,
        prompt: promptText(question, snapshot),
        requestId,
        timeoutMs: 90000,
        maxOutputTokens: OUTPUT_LIMIT,
        ...(question.nativeWebSearch
          ? {
              nativeWebSearch: {
                enabled: true as const,
                toolConfig: { type: "web_search", max_keyword: 1, limit: 3 },
                toolVersion: "ark-web-search-v1",
              },
            }
          : {}),
      },
      infrastructureSecret(ciphertext, true),
    );
    if (!result.text || result.text.length > 200000)
      throw new ModelGatewayError(
        "invalid_response",
        "PROVIDER_RESULT_UNKNOWN",
        false,
      );
    if (
      !Number.isSafeInteger(result.inputTokens) ||
      !Number.isSafeInteger(result.outputTokens) ||
      result.inputTokens < 0 ||
      result.outputTokens < 0 ||
      result.inputTokens + result.outputTokens === 0
    )
      throw new ModelGatewayError(
        "invalid_response",
        "PROVIDER_USAGE_UNKNOWN",
        false,
      );
    if (
      question.nativeWebSearch &&
      (!Number.isSafeInteger(result.searchCalls) || result.searchCalls! < 0)
    )
      throw new ModelGatewayError(
        "invalid_response",
        "PROVIDER_SEARCH_USAGE_UNKNOWN",
        false,
      );
    return result;
  }
}
