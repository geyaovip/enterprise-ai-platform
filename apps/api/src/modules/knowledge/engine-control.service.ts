import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import type { Binding } from '../platform/infrastructure-contract';
import { readBody } from '../platform/security';
import { KnowledgeEngineRegistry } from './engine-registry';
import { nativeFormats } from './native-parser';

@Injectable()
export class KnowledgeEngineControlService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly registry: KnowledgeEngineRegistry) {}
  private async current(ctx: RequestContext, manage = false) {
    this.auth.require(ctx, manage ? 'knowledge.manage' : 'knowledge.use');
    const member = await this.db.membership.findFirst({ where: { id: ctx.membershipId, tenantId: ctx.tenantId, userId: ctx.userId, active: true, tenant: { active: true }, user: { active: true } } });
    const cap = await this.db.tenantCapability.findUnique({ where: { tenantId_capability: { tenantId: ctx.tenantId, capability: 'knowledge' } } });
    if (!member || member.role !== ctx.roles[0] || !cap?.enabled || !cap.delivered) throw new ConflictException('知识库权限已变化');
  }
  async status(ctx: RequestContext) {
    await this.current(ctx);
    const [binding, profiles, transition] = await Promise.all([
      this.db.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId: ctx.tenantId, kind: 'knowledge', scopeKey: 'tenant' } } }),
      this.db.knowledgeEngineProfile.findMany({ where: { tenantId: ctx.tenantId }, select: { provider: true, baseUrl: true, secretCiphertext: true, options: true } }),
      this.db.knowledgeEngineTransition.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const currentVersions = await this.versions(this.db, ctx.tenantId);
    const ready = transition ? await this.db.knowledgeIndex.count({ where: { tenantId: ctx.tenantId, bindingId: transition.bindingId, bindingVersion: transition.targetVersion, versionId: { in: currentVersions.map(v => v.id) }, status: 'ready' } }) : 0;
    const completed = await this.db.knowledgeEngineTransition.findFirst({ where: { tenantId: ctx.tenantId, status: 'completed', targetVersion: binding?.version ?? -1 }, orderBy: { createdAt: 'desc' } });
    const embeddingCloud = binding?.provider === 'native' && !['127.0.0.1', 'localhost'].includes(new URL(binding.baseUrl).hostname);
    const addons = await this.db.infrastructureBinding.findMany({ where: { tenantId: ctx.tenantId, scopeKey: 'tenant', kind: { in: ['knowledge-ocr', 'knowledge-rerank'] }, enabled: true }, select: { kind: true, baseUrl: true } });
    const remote = (kind: string) => addons.some(x => x.kind === kind);
    const cloud = (kind: string) => addons.some(x => x.kind === kind && !['127.0.0.1', 'localhost'].includes(new URL(x.baseUrl).hostname));
    return { enhancements: binding?.provider === 'native' ? { retrieval: 'hybrid', chunking: 'structure', ocr: remote('knowledge-ocr') ? 'openai-vision' : 'tesseract', reranker: remote('knowledge-rerank') ? 'api-rerank' : 'local-rules', ocrCloud: cloud('knowledge-ocr'), rerankCloud: cloud('knowledge-rerank') } : null, provider: binding?.enabled ? binding.provider : null, version: binding?.version ?? 0, embeddingCloud, formats: binding?.provider === 'native' ? nativeFormats : ['txt', 'md', 'csv', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg'],
      choices: this.registry.providers().map(provider => ({ provider, name: provider === 'native' ? '内置轻量知识库' : 'RAGFlow', configured: profiles.some(x => x.provider === provider) || binding?.provider === provider, hasUpdate: provider === binding?.provider && profiles.some(x => x.provider === provider && (x.baseUrl !== binding.baseUrl || x.secretCiphertext !== binding.secretCiphertext || JSON.stringify(x.options) !== JSON.stringify(binding.options))) })),
      rollbackAvailable: Boolean(completed && (completed.previousSnapshot as unknown as Binding).enabled),
      transition: transition ? { id: transition.id, provider: (transition.targetSnapshot as unknown as Binding).provider, status: transition.status, errorCode: transition.errorCode, ready, total: currentVersions.length } : null };
  }
  async select(ctx: RequestContext, raw: unknown, rollback = false) {
    await this.current(ctx, true);
    const input = readBody(z.object({ provider: z.enum(['native', 'ragflow']).optional(), version: z.int().positive() }), raw);
    const old = await this.db.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId: ctx.tenantId, kind: 'knowledge', scopeKey: 'tenant' } } });
    if (!old?.enabled) throw new BadRequestException('请联系平台管理员先配置并开通知识库');
    if (old.version !== input.version) throw new ConflictException('知识引擎已变化，请刷新');
    let target: Binding; let profileVersion: number | null = null;
    if (rollback) {
      const completed = await this.db.knowledgeEngineTransition.findFirst({ where: { tenantId: ctx.tenantId, status: 'completed', targetVersion: old.version }, orderBy: { createdAt: 'desc' } });
      if (!completed) throw new BadRequestException('没有可回退的引擎');
      target = completed.previousSnapshot as unknown as Binding;
    } else {
      if (!input.provider) throw new BadRequestException('请选择知识引擎');
      const profile = await this.db.knowledgeEngineProfile.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider: input.provider } } });
      if (!profile) throw new BadRequestException('该方案尚未配置，请联系平台管理员');
      if (profile.provider === old.provider && profile.baseUrl === old.baseUrl && profile.secretCiphertext === old.secretCiphertext && JSON.stringify(profile.options) === JSON.stringify(old.options)) throw new BadRequestException('当前方案已启用，无需重复切换');
      profileVersion = profile.version; target = { ...old, provider: profile.provider, baseUrl: profile.baseUrl, secretCiphertext: profile.secretCiphertext, options: profile.options };
    }
    try { await this.registry.create(target).health(); } catch { throw new BadRequestException('目标知识引擎尚不可用，请联系管理员检查模型或服务配置；当前引擎继续使用。'); }
    await this.current(ctx, true);
    return this.db.$transaction(async tx => {
      const fresh = await tx.infrastructureBinding.findUniqueOrThrow({ where: { id: old.id } });
      if (fresh.version !== old.version || !fresh.enabled) throw new ConflictException('知识引擎已变化，请刷新');
      if (await tx.knowledgeEngineTransition.count({ where: { tenantId: ctx.tenantId, status: 'building' } })) throw new ConflictException('已有切换任务，请等待或取消');
      if (profileVersion !== null && (await tx.knowledgeEngineProfile.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider: target.provider } } }))?.version !== profileVersion) throw new ConflictException('目标配置已变化，请刷新');
      const max = await tx.knowledgeIndex.aggregate({ where: { bindingId: old.id }, _max: { bindingVersion: true } });
      const previous = await tx.knowledgeEngineTransition.aggregate({ where: { bindingId: old.id }, _max: { targetVersion: true } });
      target = { ...target, id: old.id, tenantId: ctx.tenantId, version: Math.max(old.version, max._max.bindingVersion ?? 0, previous._max.targetVersion ?? 0) + 1 };
      const transition = await tx.knowledgeEngineTransition.create({ data: { tenantId: ctx.tenantId, bindingId: old.id, baseVersion: old.version, targetVersion: target.version, targetSnapshot: target as unknown as Prisma.InputJsonValue, previousSnapshot: old as unknown as Prisma.InputJsonValue, profileVersion, createdByMembershipId: ctx.membershipId } });
      await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action: rollback ? 'platform.knowledge.engine.rollback.request' : 'platform.knowledge.engine.select', resourceType: 'KnowledgeEngine', resourceId: transition.id, detail: { provider: target.provider, targetVersion: target.version } } });
      return { id: transition.id, status: transition.status };
    }, { isolationLevel: 'Serializable' });
  }
  async cancel(ctx: RequestContext, raw: unknown) {
    await this.current(ctx, true); const { id } = readBody(z.object({ id: z.uuid() }), raw);
    return this.db.$transaction(async tx => {
      const stage = await tx.knowledgeEngineTransition.findFirst({ where: { id, tenantId: ctx.tenantId, status: 'building' } });
      if (!stage) throw new ConflictException('切换任务已结束，请刷新');
      await this.end(tx, stage, 'cancelled', 'CANCELLED');
      await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action: 'platform.knowledge.engine.cancel', resourceType: 'KnowledgeEngine', resourceId: stage.id } });
      return { status: 'cancelled' };
    }, { isolationLevel: 'Serializable' });
  }
  private versions(tx: Prisma.TransactionClient, tenantId: string) { return tx.$queryRaw<Array<{ id: string }>>`SELECT v."id" FROM "KnowledgeDocumentVersion" v JOIN "KnowledgeDocument" d ON d."id" = v."documentId" AND d."tenantId" = v."tenantId" JOIN "KnowledgeSpace" s ON s."id" = d."spaceId" AND s."tenantId" = d."tenantId" WHERE v."tenantId" = ${tenantId} AND d."status" = 'active' AND s."active" = true AND v."version" = d."currentVersion"`; }
  private async end(tx: Prisma.TransactionClient, stage: { id: string; tenantId: string; bindingId: string; targetVersion: number }, status: string, errorCode: string) {
    await tx.knowledgeEngineTransition.update({ where: { id: stage.id }, data: { status, errorCode, finishedAt: new Date() } });
    await tx.knowledgeIndex.updateMany({ where: { tenantId: stage.tenantId, bindingId: stage.bindingId, bindingVersion: stage.targetVersion, status: { notIn: ['deleting', 'deleted'] } }, data: { status: 'deleting', nextAttemptAt: null } });
  }
  async resolve(index: { tenantId: string; bindingId: string; bindingVersion: number }): Promise<Binding | null> {
    const current = await this.db.infrastructureBinding.findFirst({ where: { id: index.bindingId, tenantId: index.tenantId, enabled: true } });
    if (current?.version === index.bindingVersion) return current;
    const stage = await this.db.knowledgeEngineTransition.findFirst({ where: { tenantId: index.tenantId, bindingId: index.bindingId, targetVersion: index.bindingVersion, baseVersion: current?.version ?? -1, status: 'building' } });
    return stage ? stage.targetSnapshot as unknown as Binding : null;
  }
  async advance(): Promise<boolean> {
    const stages = await this.db.knowledgeEngineTransition.findMany({ where: { status: 'building' }, orderBy: { createdAt: 'asc' }, take: 20 });
    let work = false;
    for (const stage of stages) work = await this.db.$transaction(async tx => {
      const live = await tx.knowledgeEngineTransition.findUnique({ where: { id: stage.id } }); if (live?.status !== 'building') return false;
      const target = stage.targetSnapshot as unknown as Binding;
      const binding = await tx.infrastructureBinding.findUnique({ where: { id: stage.bindingId } });
      const tenant = await tx.tenant.findUnique({ where: { id: stage.tenantId } });
      const cap = await tx.tenantCapability.findUnique({ where: { tenantId_capability: { tenantId: stage.tenantId, capability: 'knowledge' } } });
      const member = await tx.membership.findFirst({ where: { id: stage.createdByMembershipId, tenantId: stage.tenantId, active: true, role: 'admin', user: { active: true } } });
      const profile = await tx.knowledgeEngineProfile.findUnique({ where: { tenantId_provider: { tenantId: stage.tenantId, provider: target.provider } } });
      if (!binding?.enabled || binding.version !== stage.baseVersion || !tenant?.active || !cap?.enabled || !cap.delivered || !member || stage.profileVersion !== null && profile?.version !== stage.profileVersion) { await this.end(tx, stage, 'failed', 'CONFIGURATION_CHANGED'); return true; }
      const versions = await this.versions(tx, stage.tenantId);
      const indexes = await tx.knowledgeIndex.findMany({ where: { tenantId: stage.tenantId, bindingId: stage.bindingId, bindingVersion: stage.targetVersion, versionId: { in: versions.map(x => x.id) } } });
      const failed = indexes.find(x => ['failed', 'deleted', 'deleting', 'superseded'].includes(x.status));
      if (failed) { await this.end(tx, stage, 'failed', failed.errorCode ?? 'INDEX_FAILED'); return true; }
      const missing = versions.filter(v => !indexes.some(i => i.versionId === v.id)).slice(0, 20);
      if (missing.length) { await tx.knowledgeIndex.createMany({ data: missing.map(v => ({ tenantId: stage.tenantId, versionId: v.id, bindingId: stage.bindingId, bindingVersion: stage.targetVersion, provider: target.provider, bindingSnapshot: target as unknown as Prisma.InputJsonValue })) }); return true; }
      if (indexes.some(i => i.status !== 'ready')) return false;
      await tx.infrastructureBinding.update({ where: { id: binding.id }, data: { provider: target.provider, baseUrl: target.baseUrl, secretCiphertext: target.secretCiphertext, options: target.options as Prisma.InputJsonValue, version: target.version } });
      await tx.knowledgeEngineTransition.update({ where: { id: stage.id }, data: { status: 'completed', finishedAt: new Date() } });
      await tx.knowledgeIndex.updateMany({ where: { tenantId: stage.tenantId, bindingId: stage.bindingId, bindingVersion: { not: target.version }, status: { notIn: ['deleted', 'deleting'] } }, data: { status: 'deleting', nextAttemptAt: null } });
      await tx.auditEvent.create({ data: { tenantId: stage.tenantId, membershipId: member.id, userId: member.userId, appId: 'platform', requestId: stage.id, action: 'platform.knowledge.engine.activated', resourceType: 'KnowledgeEngine', resourceId: stage.id, detail: { provider: target.provider, version: target.version } } });
      return true;
    }, { isolationLevel: 'Serializable' }) || work;
    return work;
  }
}
