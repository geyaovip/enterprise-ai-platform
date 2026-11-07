/** Platform-owned technical media channel. Secrets stay in the server environment. */
import { createHash } from "node:crypto";
export const CONTENT_SEEDREAM_MODEL = "doubao-seedream-4-5-251128";
export function mediaChannelEndpoint() {
  const u = new URL(
    process.env.CONTENT_ARK_BASE_URL ??
      process.env.BOM_VISION_BASE_URL ??
      "https://ark.cn-beijing.volces.com/api/v3",
  );
  const local =
    process.env.NODE_ENV === "test" &&
    u.hostname === "127.0.0.1" &&
    u.protocol === "http:";
  if (
    !local &&
    (u.protocol !== "https:" ||
      u.hostname !== "ark.cn-beijing.volces.com" ||
      u.pathname.replace(/\/$/, "") !== "/api/v3")
  )
    throw new Error("CONTENT_CONFIG_INVALID");
  if (u.username || u.password || u.search || u.hash)
    throw new Error("CONTENT_CONFIG_INVALID");
  return u.href.replace(/\/$/, "");
}
export function contentImageCredential() {
  return (
    process.env.CONTENT_ARK_API_KEY ||
    process.env.BOM_VISION_API_KEY ||
    process.env.ARK_API_KEY
  );
}
export function contentImageModel() {
  return process.env.CONTENT_SEEDREAM_MODEL ?? CONTENT_SEEDREAM_MODEL;
}
export function contentImageBinding() {
  const credentialReference = process.env.CONTENT_ARK_API_KEY
    ? "CONTENT_ARK_API_KEY"
    : process.env.BOM_VISION_API_KEY
      ? "BOM_VISION_API_KEY"
      : "ARK_API_KEY";
  const descriptor = {
    purpose: "content.image",
    provider: "volcano-ark",
    endpoint: mediaChannelEndpoint(),
    model: contentImageModel(),
    credentialReference,
    configurationRevision: process.env.CONTENT_MEDIA_CONFIG_VERSION ?? "1",
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
