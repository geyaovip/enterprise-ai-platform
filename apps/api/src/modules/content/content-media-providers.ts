import { z } from "zod";
import { outputLimit } from "./content-media-formats";

export const mediaKey = () => process.env.MEDIAKIT_API_KEY?.trim();
export const voiceKey = () => process.env.CONTENT_DOUBAO_VOICE_API_KEY?.trim();
const mediaBase = "https://mediakit.cn-beijing.volces.com/api/v1";
const voiceUrl = "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse";

function testEndpoint(value: string | undefined) {
  if (process.env.NODE_ENV !== "test" || !value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw Error("TEST_ENDPOINT");
  return value.replace(/\/$/, "");
}

export class MediaProviderError extends Error {
  constructor(message: string, readonly retryable = false, readonly status?: number) { super(message); }
}
const unavailable = (name: string) => new MediaProviderError(name + "连接失败，稍后重试", true);
const invalid = (name: string) => new MediaProviderError(name + "返回了无法读取的结果");
const denied = (name: string, status: number) => new MediaProviderError(name + "拒绝了请求，请检查开通状态、权限或素材", false, status);

async function providerFetch(url: string, init: RequestInit, timeout: number, label: string) {
  try { return await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeout) }); }
  catch { throw unavailable(label); }
}

async function boundedBody(response: Response, max: number) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("EMPTY_BODY");
  const parts: Buffer[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw Error("BODY_LIMIT");
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts, length);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function mediaRequest(path: string, body?: object) {
  const credential = mediaKey();
  if (!credential) throw new MediaProviderError("当前环境尚未配置 AI MediaKit");
  const response = await providerFetch((testEndpoint(process.env.CONTENT_TEST_MEDIAKIT_URL) ?? mediaBase) + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer " + credential, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  }, 15000, "AI MediaKit");
  let raw;
  try { raw = JSON.parse((await boundedBody(response, 1024 * 1024)).toString("utf8")); }
  catch {
    if (response.status === 429 || response.status >= 500 || response.ok) throw unavailable("AI MediaKit");
    throw denied("AI MediaKit", response.status);
  }
  if (response.status === 429 || response.status >= 500) throw unavailable("AI MediaKit");
  if (raw?.error?.code === "InvalidParameter.AmkAbilityNotFound" || raw?.error?.code === "AmkAbilityNotFound")
    throw new MediaProviderError("AI MediaKit 未为当前账号开通，或当前 Key 与开通账号不匹配", false, response.status);
  if (!response.ok || raw?.success !== true) throw denied("AI MediaKit", response.status);
  return raw as { task_id?: unknown; status?: unknown; result?: unknown };
}

function signedMediaUrl(raw: unknown) {
  if (typeof raw !== "string") throw invalid("AI MediaKit");
  let url: URL;
  try { url = new URL(raw); } catch { throw invalid("AI MediaKit"); }
  const host = url.hostname;
  const test = testEndpoint(process.env.CONTENT_TEST_MEDIAKIT_URL);
  if (url.username || url.password || url.hash) throw invalid("AI MediaKit");
  if (test && url.origin === new URL(test).origin) return url.toString();
  const vod = /^(?:[a-z0-9-]+\.)+(?:volcvod\.com|volcvideo\.com|volces\.com|volcecdn\.com|volccdn\.com|bytecdn\.cn|bytedanceapi\.com)$/.test(host);
  if (url.protocol !== "https:" || url.port || !vod) throw invalid("AI MediaKit");
  return url.toString();
}

const uploadTicket = z.object({
  file_id: z.string().regex(/^mediakit:\/\/[\w/-]{1,240}$/),
  method: z.literal("PUT"),
  upload_url: z.string(),
  upload_headers: z.array(z.object({ key: z.string(), value: z.string() })).nullish(),
});

export async function mediaUpload(bytes: Buffer, mime: string) {
  const raw = await mediaRequest("/tools-sync/request-media-upload-url", { content_type: mime });
  return uploadMedia(raw.result, bytes, mime);
}

async function uploadMedia(data: unknown, bytes: Buffer, mime: string) {
  const ticket = uploadTicket.safeParse(data);
  if (!ticket.success) throw invalid("AI MediaKit 上传");
  const headers = new Headers({ "content-type": mime });
  for (const { key, value } of ticket.data.upload_headers ?? []) {
    if (!/^(content-type|content-md5|x-tos-[\w-]+)$/i.test(key)) throw invalid("AI MediaKit 上传");
    headers.set(key, value);
  }
  const response = await providerFetch(signedMediaUrl(ticket.data.upload_url), {
    method: "PUT", headers, body: Uint8Array.from(bytes),
  }, 45000, "AI MediaKit 上传");
  await response.body?.cancel().catch(() => {});
  if (!response.ok) throw new MediaProviderError("素材上传失败", response.status === 429 || response.status >= 500, response.status);
  return ticket.data.file_id;
}

const taskId = z.string().regex(/^[\w-]{1,200}$/);
export async function mediaSubmit(tool: "face-swap-video" | "asr-subtitles" | "lip-sync", input: object, token: string) {
  const raw = await mediaRequest("/tools/" + tool, { ...input, client_token: token });
  const task = taskId.safeParse(raw.task_id);
  if (!task.success) throw new MediaProviderError("AI MediaKit 暂未返回任务编号", true);
  return task.data;
}

export async function mediaPoll(id: string) {
  const raw = await mediaRequest("/tasks/" + encodeURIComponent(id));
  if (raw.status === "completed") return raw.result ?? {};
  if (["failed", "canceled", "cancelled"].includes(String(raw.status))) throw new MediaProviderError("AI MediaKit 处理失败，请检查素材和服务任务记录");
  if (!["pending", "queued", "running", "processing", "submitted", "created"].includes(String(raw.status))) throw invalid("AI MediaKit");
  return undefined;
}

export async function downloadMedia(url: unknown) {
  const response = await providerFetch(signedMediaUrl(url), {}, 45000, "AI MediaKit 下载");
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new MediaProviderError("暂时无法保存 AI MediaKit 成片", true, response.status);
  }
  try { return await boundedBody(response, outputLimit); }
  catch { throw new MediaProviderError("成片下载中断或超过 64 MB", true); }
}

export async function synthesizeVoice(text: string, id: string) {
  const credential = voiceKey();
  if (!credential) throw new MediaProviderError("当前环境尚未配置豆包语音");
  const response = await providerFetch(testEndpoint(process.env.CONTENT_TEST_VOICE_URL) ?? voiceUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Api-Key": credential,
      "X-Api-Request-Id": id,
      "X-Api-Resource-Id": "seed-tts-2.0",
      "X-Control-Require-Usage-Tokens-Return": "*",
    },
    body: JSON.stringify({ req_params: {
      text, speaker: "zh_female_vv_uranus_bigtts", audio_params: { format: "mp3", sample_rate: 24000 },
      additions: JSON.stringify({ aigc_watermark: true, aigc_metadata: {
        enable: true, content_producer: "知行方舟", produce_id: id,
        content_propagator: "知行方舟", propagate_id: id,
      } }),
    } }),
  }, 55000, "豆包语音");
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status >= 500 || response.status === 408) throw unavailable("豆包语音");
    throw denied("豆包语音", response.status);
  }
  let raw: Buffer;
  try { raw = await boundedBody(response, 12 * 1024 * 1024); }
  catch { throw unavailable("豆包语音"); }
  const audio: Buffer[] = [];
  let finished = false;
  let units: number | undefined;
  for (const line of raw.toString("utf8").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    let event: { code?: number; data?: string | null; usage?: { text_words?: number } };
    try { event = JSON.parse(line.slice(5)); } catch { throw unavailable("豆包语音"); }
    if (event.code === 20000000) {
      finished = true;
      units = event.usage?.text_words;
      break;
    }
    if (event.code !== 0) throw denied("豆包语音", 400);
    if (typeof event.data === "string") audio.push(Buffer.from(event.data, "base64"));
  }
  if (!finished || !audio.length) throw unavailable("豆包语音");
  return { bytes: Buffer.concat(audio), units };
}
