import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';

const settingsInput = z.object({ model: z.string().trim().min(1).max(120), baseUrl: z.url(), apiKey: z.string().min(8).max(1000) });
const providerResponse = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1), usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional() });

@Injectable()
export class ModelGateway {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  private key() {
    const raw = process.env.AI_ENCRYPTION_KEY;
    const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
    if (key.length !== 32) throw new ServiceUnavailableException('AI 加密密钥未配置');
    return key;
  }

  private encrypt(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ciphertext.toString('base64')}`;
  }

  private decrypt(stored: string) {
    const [ivRaw, tagRaw, ciphertextRaw] = stored.split('.');
    if (!ivRaw || !tagRaw || !ciphertextRaw) throw new ServiceUnavailableException('AI 密钥记录无效');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, 'base64')), decipher.final()]).toString('utf8');
  }

  private endpoint(raw: string) {
    const url = new URL(raw);
    const localTest = process.env.NODE_ENV === 'test' && url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !localTest) throw new BadRequestException('模型地址必须使用 HTTPS');
    if (url.username || url.password || url.search || url.hash) throw new BadRequestException('模型地址不能包含认证信息或查询参数');
    if (!localTest && (url.hostname === 'localhost' || isIP(url.hostname) !== 0)) throw new BadRequestException('模型地址必须是公网域名');
    const allowed = (process.env.AI_PROVIDER_ALLOWED_HOSTS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (process.env.NODE_ENV === 'production' && !allowed.length) throw new BadRequestException('服务端尚未配置允许的模型域名');
    if (allowed.length && !allowed.includes(url.hostname.toLowerCase())) throw new BadRequestException('模型地址不在服务端允许名单中');
    return `${url.toString().replace(/\/$/, '')}/chat/completions`;
  }

  async status(ctx: RequestContext) {
    const settings = await this.db.aiProviderSettings.findUnique({ where: { tenantId: ctx.tenantId } });
    return settings ? { configured: true, model: settings.model, baseUrl: settings.baseUrl, updatedAt: settings.updatedAt } : { configured: false };
  }

  async save(ctx: RequestContext, body: unknown) {
    this.auth.require(ctx, 'platform.manage');
    const input = readBody(settingsInput, body);
    this.endpoint(input.baseUrl);
    return this.db.$transaction(async tx => {
      await tx.aiProviderSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, model: input.model, baseUrl: input.baseUrl, keyCiphertext: this.encrypt(input.apiKey), updatedBy: ctx.userId }, update: { model: input.model, baseUrl: input.baseUrl, keyCiphertext: this.encrypt(input.apiKey), updatedBy: ctx.userId } });
      await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action: 'platform.ai.settings.update', resourceType: 'AiProviderSettings', resourceId: ctx.tenantId } });
      return { configured: true, model: input.model, baseUrl: input.baseUrl };
    });
  }

  async clear(ctx: RequestContext) {
    this.auth.require(ctx, 'platform.manage');
    return this.db.$transaction(async tx => {
      await tx.aiProviderSettings.deleteMany({ where: { tenantId: ctx.tenantId } });
      await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action: 'platform.ai.settings.clear', resourceType: 'AiProviderSettings', resourceId: ctx.tenantId } });
      return { configured: false };
    });
  }

  async complete(ctx: RequestContext, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) {
    const settings = await this.db.aiProviderSettings.findUnique({ where: { tenantId: ctx.tenantId } });
    if (!settings) throw new ServiceUnavailableException('当前企业尚未配置 AI 模型');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let status = 'failed';
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    try {
      const response = await fetch(this.endpoint(settings.baseUrl), { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${this.decrypt(settings.keyCiphertext)}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: settings.model, messages, temperature: 0.2 }), signal: controller.signal });
      if (!response.ok) throw new ServiceUnavailableException(`模型服务返回 ${response.status}`);
      const parsed = providerResponse.safeParse(await response.json());
      if (!parsed.success || !parsed.data.choices[0].message.content) throw new ServiceUnavailableException('模型返回结构无效');
      usage = parsed.data.usage;
      status = 'completed';
      return parsed.data.choices[0].message.content;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('模型连接失败或超时');
    } finally {
      clearTimeout(timeout);
      await this.db.aiUsage.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, appId: ctx.app.appId, model: settings.model, inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens, status } });
    }
  }

  async test(ctx: RequestContext) {
    this.auth.require(ctx, 'platform.manage');
    const answer = await this.complete(ctx, [{ role: 'user', content: '请只回复 READY' }]);
    return { ok: true, answer: answer.slice(0, 100) };
  }
}
