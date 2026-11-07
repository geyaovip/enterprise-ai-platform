import type { MediaModelChannel } from "../platform/model-channels";
import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  CONTENT_SEEDREAM_MODEL,
  contentImageBinding,
  contentImageCredential,
  contentImageModel,
  mediaChannelEndpoint,
} from "../platform/media-channel";
export const SEEDREAM = CONTENT_SEEDREAM_MODEL;
export class MediaError extends Error {
  constructor(
    readonly code: string,
    readonly definitive = false,
    readonly externalId?: string,
  ) {
    super(code);
  }
}
@Injectable()
export class SeedreamProvider {
  binding(channel?: MediaModelChannel) {
    if (!channel) return contentImageBinding();
    const descriptor = {
      purpose: "content.image",
      provider: "volcano-ark",
      endpoint: channel.baseUrl,
      model: channel.model,
      credentialReference: "enterprise:" + channel.reference,
      configurationRevision: channel.reference,
      capabilities: {
        output: "image",
        referenceImage: true,
        size: "2K",
        automaticRetry: false,
      },
    };
    return {
      ...descriptor,
      version: createHash("sha256")
        .update(JSON.stringify(descriptor))
        .digest("hex"),
    };
  }
  configured(channel?: MediaModelChannel) {
    try {
      return (
        Boolean(this.key(channel)) &&
        Boolean(channel?.baseUrl ?? mediaChannelEndpoint())
      );
    } catch {
      return false;
    }
  }
  key(channel?: MediaModelChannel) {
    return channel?.apiKey ?? contentImageCredential();
  }
  model(channel?: MediaModelChannel) {
    return channel?.model ?? contentImageModel();
  }
  async generate(
    prompt: string,
    attemptId: string,
    image?: string | string[],
    bindingVersion?: string,
    size = "2K",
    channel?: MediaModelChannel,
  ) {
    if (!this.configured(channel))
      throw new MediaError("CONTENT_MODEL_NOT_CONFIGURED", true);
    if (bindingVersion && this.binding(channel).version !== bindingVersion)
      throw new MediaError("CONTENT_MODEL_BINDING_CHANGED", true);
    let response: Response;
    try {
      response = await fetch(
        (channel?.baseUrl ?? mediaChannelEndpoint()) + "/images/generations",
        {
          method: "POST",
          headers: {
            authorization: "Bearer " + this.key(channel),
            "content-type": "application/json",
            "x-client-request-id": attemptId,
          },
          body: JSON.stringify({
            model: this.model(channel),
            prompt,
            size,
            response_format: "b64_json",
            watermark: false,
            sequential_image_generation: "disabled",
            ...(image ? { image } : {}),
          }),
          signal: AbortSignal.timeout(240000),
          redirect: "error",
        },
      );
    } catch {
      throw new MediaError("CONTENT_SUBMISSION_UNKNOWN");
    }
    // Never retry a paid POST. 429/4xx are rejected requests; 5xx can have accepted work.
    if (!response.ok)
      throw new MediaError(
        "CONTENT_PROVIDER_HTTP_" + response.status,
        response.status >= 400 && response.status < 500,
        response.headers.get("x-tt-logid") ?? undefined,
      );
    const [width, height] = size.split("x").map(Number);
    const large = width * height > 5000000 || size === "4K";
    let data: any;
    try {
      const reader = response.body!.getReader();
      const chunks: Buffer[] = [];
      let bytes = 0;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        bytes += r.value.byteLength;
        if (bytes > (large ? 56 : 32) * 1024 * 1024) {
          await reader.cancel();
          throw Error();
        }
        chunks.push(Buffer.from(r.value));
      }
      data = JSON.parse(Buffer.concat(chunks, bytes).toString());
    } catch {
      throw new MediaError("CONTENT_RESPONSE_UNKNOWN");
    }
    const first = data.data?.[0];
    if (!first?.b64_json) {
      throw new MediaError("CONTENT_RESULT_UNKNOWN");
    }
    if (
      !/^[A-Za-z0-9+/=\r\n]+$/.test(first.b64_json) ||
      first.b64_json.length > (large ? 54 : 28) * 1024 * 1024
    )
      throw new MediaError("CONTENT_RESULT_INVALID");
    return {
      image: first.b64_json,
      externalId:
        typeof data.id === "string"
          ? data.id
          : (response.headers.get("x-tt-logid") ?? undefined),
      usage: data.usage ?? null,
      model: data.model ?? this.model(channel),
    };
  }
}
