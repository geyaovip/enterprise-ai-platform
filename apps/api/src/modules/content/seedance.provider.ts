import { createHash } from "node:crypto";
import { z } from "zod";
import {
  contentImageBinding,
  contentImageCredential,
  mediaChannelEndpoint,
} from "../platform/media-channel";
import {
  DEFAULT_VIDEO_MODEL,
  type MediaModelChannel,
} from "../platform/model-channels";
import { MediaError } from "./seedream.provider";

export const videoRatios = [
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "21:9",
  "adaptive",
] as const;
export const videoOptions = z
  .object({
    ratio: z.enum(videoRatios),
    resolution: z.enum(["480p", "720p", "1080p"]),
    duration: z.int().min(2).max(12),
  })
  .strict();
export type VideoOptions = z.infer<typeof videoOptions>;

export class SeedanceProvider {
  model(channel?: MediaModelChannel) {
    return (
      channel?.model ??
      process.env.CONTENT_SEEDANCE_MODEL ??
      DEFAULT_VIDEO_MODEL
    );
  }

  configured(channel?: MediaModelChannel) {
    try {
      return (
        /^doubao-seedance-1-0-pro-fast(?:-|$)/.test(this.model(channel)) &&
        Boolean(channel?.apiKey ?? contentImageCredential()) &&
        Boolean(channel?.baseUrl ?? mediaChannelEndpoint())
      );
    } catch {
      return false;
    }
  }

  binding(channel?: MediaModelChannel) {
    const identity = channel
      ? [channel.reference, channel.baseUrl]
      : [contentImageBinding().version];
    return createHash("sha256")
      .update(JSON.stringify([this.model(channel), ...identity]))
      .digest("hex");
  }

  private async request(
    channel: MediaModelChannel | undefined,
    path: string,
    body?: object,
  ) {
    const result = await fetch(
      (channel?.baseUrl ?? mediaChannelEndpoint()) +
        "/contents/generations/tasks" +
        path,
      {
        method: body ? "POST" : "GET",
        headers: {
          authorization:
            "Bearer " + (channel?.apiKey ?? contentImageCredential()),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    ).catch(() => {
      throw new MediaError(
        body ? "CONTENT_SUBMISSION_UNKNOWN" : "CONTENT_VIDEO_POLL",
      );
    });
    if (!result.ok)
      throw new MediaError(
        body ? "CONTENT_PROVIDER_HTTP_" + result.status : "CONTENT_VIDEO_POLL",
        Boolean(body && result.status >= 400 && result.status < 500),
      );
    return result.json().catch(() => {
      throw new MediaError(
        body ? "CONTENT_RESPONSE_UNKNOWN" : "CONTENT_VIDEO_POLL",
      );
    });
  }

  async submit(
    prompt: string,
    options: VideoOptions,
    firstFrame: string | undefined,
    channel?: MediaModelChannel,
  ) {
    const data = await this.request(channel, "", {
      model: this.model(channel),
      content: [
        { type: "text", text: prompt },
        ...(firstFrame
          ? [
              {
                type: "image_url",
                image_url: { url: firstFrame },
                role: "first_frame",
              },
            ]
          : []),
      ],
      ...options,
      watermark: false,
    });
    if (typeof data?.id !== "string" || !/^[\w-]{1,128}$/.test(data.id))
      throw new MediaError("CONTENT_VIDEO_TASK_ID_UNKNOWN");
    return data.id as string;
  }

  async poll(taskId: string, channel?: MediaModelChannel) {
    return this.request(channel, "/" + encodeURIComponent(taskId));
  }

  async download(rawUrl: unknown) {
    if (typeof rawUrl !== "string")
      throw new MediaError("CONTENT_VIDEO_URL_INVALID");
    const url = new URL(rawUrl);
    const test =
      process.env.NODE_ENV === "test" &&
      url.origin === new URL(mediaChannelEndpoint()).origin;
    if (
      url.username ||
      url.password ||
      (!test &&
        (url.protocol !== "https:" ||
          url.port ||
          !/^[-a-z0-9]+\.tos-cn-beijing\.volces\.com$/.test(url.hostname)))
    )
      throw new MediaError("CONTENT_VIDEO_URL_INVALID");
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok || !response.body)
      throw new MediaError("CONTENT_VIDEO_DOWNLOAD_FAILED");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 48 * 1024 * 1024) {
        await reader.cancel();
        throw new MediaError("CONTENT_VIDEO_TOO_LARGE");
      }
      chunks.push(Buffer.from(chunk.value));
    }
    const bytes = Buffer.concat(chunks, size);
    if (bytes.length < 24 || bytes.toString("ascii", 4, 8) !== "ftyp")
      throw new MediaError("CONTENT_VIDEO_FILE_INVALID");
    return bytes;
  }
}
