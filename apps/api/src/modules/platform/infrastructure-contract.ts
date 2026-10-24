import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export type Binding = { id: string; tenantId: string; kind: string; scopeKey: string; provider: string; baseUrl: string; secretCiphertext: string; options: unknown; version: number; enabled: boolean };
export function infrastructureSecret(value: string, decrypt = false) {
  const key = Buffer.from(process.env.AI_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) throw new ServiceUnavailableException('基础设施加密密钥未配置');
  if (decrypt) {
    try {
      const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64'));
      const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
    } catch { throw new ServiceUnavailableException('基础设施凭据无效'); }
  }
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(x => x.toString('base64')).join('.');
}

export function infrastructureEndpoint(raw: string) {
  const url = new URL(raw);
  const allowed = (process.env.INFRASTRUCTURE_ALLOWED_HOSTS ?? '').split(',').map(x => x.trim().toLowerCase());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new BadRequestException('基础设施地址无效');
  const managed = process.env.RUNTIME_MANAGER_SOCKET && /^gateway-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(url.hostname) && url.port === '18789';
  if (!managed && !(process.env.NODE_ENV === 'test' && url.hostname === '127.0.0.1') && !allowed.includes(url.hostname.toLowerCase())) throw new BadRequestException('基础设施地址不在服务端允许名单中');
  return url.toString().replace(/\/$/, '');
}

