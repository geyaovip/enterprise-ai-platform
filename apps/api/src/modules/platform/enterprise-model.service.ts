import type { Prisma } from '../../generated/prisma/client';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';
import type { RequestContext } from './context';
import { readBody } from './security';
import { infrastructureSecret } from './infrastructure-contract';
import { ModelGateway } from '../ai/model.gateway';
import { contentImageCredential, contentImageModel, mediaChannelEndpoint } from './media-channel';
import { DEFAULT_CHAT_MODEL, DEFAULT_VIDEO_MODEL, modelEndpoint, platformTextModel, type MediaModelChannel } from './model-channels';

export const modelKind = z.enum(['text', 'image', 'video']);
type Kind = z.infer<typeof modelKind>;
const input = z.object({ model: z.string().trim().min(1).max(120), baseUrl: z.url(), apiKey: z.string().min(8).max(1000), version: z.int().nonnegative().optional() }).strict();

@Injectable()
export class EnterpriseModelService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly text: ModelGateway) {}

  private authorize(ctx: RequestContext) { this.auth.require(ctx, 'platform.manage'); }
  private kind(kind: string) { return readBody(modelKind, kind); }

  async customMedia(tenantId: string, kind: 'image' | 'video', db: Prisma.TransactionClient = this.db): Promise<MediaModelChannel | undefined> {
    const row = await db.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId, kind: 'model-' + kind, scopeKey: 'tenant' } } });
    if (!row?.enabled) return undefined;
    return { model: (row.options as { model: string }).model, baseUrl: modelEndpoint(row.baseUrl), apiKey: infrastructureSecret(row.secretCiphertext, true), reference: row.id + ':' + row.version };
  }

  async list(ctx: RequestContext) {
    this.authorize(ctx);
    const text = await this.text.status(ctx), defaults = platformTextModel();
    const values: Record<Kind, unknown> = {
      text: { source: text.configured ? 'custom' : 'platform', configured: text.configured || Boolean(defaults), model: text.configured ? text.model : DEFAULT_CHAT_MODEL, baseUrl: text.configured ? text.baseUrl : defaults?.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3', version: 0 },
      image: null, video: null,
    };
    for (const kind of ['image', 'video'] as const) {
      const row = await this.db.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId: ctx.tenantId, kind: 'model-' + kind, scopeKey: 'tenant' } } });
      values[kind] = row?.enabled ? { source: 'custom', configured: true, model: (row.options as { model: string }).model, baseUrl: row.baseUrl, version: row.version } : {
        source: 'platform', configured: Boolean(contentImageCredential()), model: kind === 'image' ? contentImageModel() : process.env.CONTENT_SEEDANCE_MODEL ?? DEFAULT_VIDEO_MODEL, baseUrl: mediaChannelEndpoint(), version: row?.version ?? 0,
      };
    }
    return values;
  }

  private async idle(ctx: RequestContext, kind: Kind, db: Prisma.TransactionClient = this.db) {
    const active = kind === 'text'
      ? (await db.aiExecution.count({ where: { tenantId: ctx.tenantId, status: { in: ['queued', 'preparing', 'running'] } } })) + (await db.aiTask.count({ where: { tenantId: ctx.tenantId, status: { in: ['queued', 'running'] } } }))
      : await db.contentGenerationItem.count({ where: {
        tenantId: ctx.tenantId,
        status: { in: ['queued', 'submitting', 'storing', 'rendering', 'needs_reconciliation'] },
        ...(kind === 'video'
          ? { input: { path: ['mode'], equals: 'video' } }
          : { NOT: { input: { path: ['mode'], equals: 'video' } } }),
      } });
    if (active) throw new BadRequestException(kind === 'text' ? '仍有 AI 请求正在处理，请结束后调整模型' : '仍有生成任务待完成或核对，请处理后调整模型');
  }

  async save(ctx: RequestContext, rawKind: string, body: unknown) {
    this.authorize(ctx); const kind = this.kind(rawKind), v = readBody(input, body), baseUrl = modelEndpoint(v.baseUrl);
    await this.idle(ctx, kind);
    if (kind === 'text') { await this.text.save(ctx, { model: v.model, baseUrl, apiKey: v.apiKey }); return this.list(ctx); }
    if (v.version === undefined) throw new BadRequestException('请重新读取模型配置后保存');
    await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ':model:' + kind}))`;
      await this.idle(ctx, kind, tx);
      const where = { tenantId: ctx.tenantId, kind: 'model-' + kind, scopeKey: 'tenant' };
      const old = await tx.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: where } });
      if ((old?.version ?? 0) !== v.version) throw new ConflictException('模型配置已变化，请刷新后再保存');
      const data = { provider: 'volcano-ark', baseUrl, secretCiphertext: infrastructureSecret(v.apiKey), options: { model: v.model }, enabled: true };
      const row = old ? await tx.infrastructureBinding.update({ where: { id: old.id }, data: { ...data, version: { increment: 1 } } }) : await tx.infrastructureBinding.create({ data: { ...where, ...data } });
      await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action: 'platform.model.' + kind + '.update', resourceType: 'InfrastructureBinding', resourceId: row.id } });
    });
    return this.list(ctx);
  }

  async reset(ctx: RequestContext, rawKind: string, body: unknown) {
    this.authorize(ctx); const kind = this.kind(rawKind); await this.idle(ctx, kind);
    if (kind === 'text') { await this.text.clear(ctx); return this.list(ctx); }
    const v = readBody(z.object({ version: z.int().positive() }).strict(), body);
    await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ':model:' + kind}))`;
      await this.idle(ctx, kind, tx);
      const removed = await tx.infrastructureBinding.updateMany({ where: { tenantId: ctx.tenantId, kind: 'model-' + kind, scopeKey: 'tenant', version: v.version, enabled: true }, data: { enabled: false, secretCiphertext: '', options: {}, version: { increment: 1 } } });
      if (!removed.count) throw new ConflictException('模型配置已变化，请刷新后再操作');
      await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action: 'platform.model.' + kind + '.reset', resourceType: 'InfrastructureBinding', resourceId: ctx.tenantId } });
    });
    return this.list(ctx);
  }
}
