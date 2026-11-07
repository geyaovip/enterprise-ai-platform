import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';
import { contentImageCredential, mediaChannelEndpoint } from './media-channel';

export type MediaModelChannel = { model: string; baseUrl: string; apiKey: string; reference: string };
export const DEFAULT_CHAT_MODEL = 'deepseek-v4-1-flash-economy-261017';
export const DEFAULT_VIDEO_MODEL = 'doubao-seedance-1-0-pro-fast-251015';

export function modelEndpoint(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new BadRequestException('模型 API 地址无效'); }
  const local = process.env.NODE_ENV === 'test' && url.hostname === '127.0.0.1' && url.protocol === 'http:';
  const allowed = (process.env.AI_PROVIDER_ALLOWED_HOSTS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if ((!local && (url.protocol !== 'https:' || isIP(url.hostname) !== 0 || url.hostname === 'localhost')) || url.username || url.password || url.search || url.hash)
    throw new BadRequestException('模型地址须为不含认证信息和查询参数的 HTTPS 公网地址');
  if (!local && (!allowed.length || !allowed.includes(url.hostname.toLowerCase()))) throw new BadRequestException('模型地址不在服务端允许名单中');
  return url.toString().replace(/\/$/, '');
}

// Platform credential only. Never borrow a tenant's provider configuration or profile.
export function platformTextModel(): { model: string; baseUrl: string; apiKey: string; platformDefault: true } | null {
  if (process.env.NATIVE_CHAT_DEFAULT_ENABLED !== 'true') return null;
  try {
  const model = process.env.NATIVE_CHAT_MODEL_ID ?? DEFAULT_CHAT_MODEL;
  if (model !== DEFAULT_CHAT_MODEL) return null;
  const apiKey = process.env.NATIVE_CHAT_API_KEY || contentImageCredential();
  if (!apiKey) return null;
  const baseUrl = process.env.NATIVE_CHAT_BASE_URL ?? mediaChannelEndpoint();
  const local = process.env.NODE_ENV === 'test' && new URL(baseUrl).hostname === '127.0.0.1';
  if (!local && new URL(baseUrl).hostname !== 'ark.cn-beijing.volces.com') return null;
  return { model, baseUrl: modelEndpoint(baseUrl), apiKey, platformDefault: true };
  } catch { return null; }
}
