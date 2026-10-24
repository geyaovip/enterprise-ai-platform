import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import { InfrastructureService } from '../platform/infrastructure.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { decodeFile, readOriginal, removeOriginal, storeOriginal } from './knowledge-storage';
import { QuotaService } from '../orchestration/quota.service';
import { KnowledgeEngineRegistry } from './engine-registry';
import { nativeFormats } from './native-parser';

const grantSchema = z.object({ subjectType: z.enum(['member', 'org']), subjectId: z.uuid(), access: z.enum(['read', 'write']) });
const spaceInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).default(''), visibility: z.enum(['tenant', 'restricted']).default('restricted'), ownerMembershipId: z.uuid().optional(), grants: z.array(grantSchema).max(200).default([]) });
const uploadInput = z.object({ filename: z.string().trim().min(1).max(180).regex(/^[^/\\\x00-\x1f]+$/), title: z.string().trim().min(1).max(180), contentBase64: z.string().max(12_000_000), expectedVersion: z.int().positive().optional() });

@Injectable()
export class KnowledgeService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly infra: InfrastructureService, private readonly registry: KnowledgeEngineRegistry, private readonly quota:QuotaService) {}
  private audit(ctx: RequestContext, action: string, resourceId: string) { return { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action, resourceType: 'Knowledge', resourceId }; }
  private async current(ctx: RequestContext) {
    this.auth.require(ctx, 'knowledge.use');
    const [member, cap] = await Promise.all([this.db.membership.findFirst({ where: { id: ctx.membershipId, tenantId: ctx.tenantId, userId: ctx.userId, active: true, tenant: { active: true }, user: { active: true } } }), this.db.tenantCapability.findUnique({ where: { tenantId_capability: { tenantId: ctx.tenantId, capability: 'knowledge' } } })]);
    if (!member || member.role !== ctx.roles[0] || !cap?.delivered || !cap.enabled) throw new ConflictException('知识访问权限已变化');
  }
  private async orgScope(ctx: RequestContext) {
    const [relations, orgs] = await Promise.all([this.db.membershipOrg.findMany({ where: { tenantId: ctx.tenantId, membershipId: ctx.membershipId } }), this.db.orgUnit.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, parentId: true } })]);
    const ids = new Set<string>();
    for (const relation of relations) { let id: string | null = relation.orgUnitId; while (id && !ids.has(id)) { const org = orgs.find(x => x.id === id); if (!org) break; ids.add(id); id = org.parentId; } }
    return [...ids];
  }
  private async allowedSpaces(ctx: RequestContext, write = false) {
    await this.current(ctx);
    const orgIds = await this.orgScope(ctx);
    return this.db.knowledgeSpace.findMany({ where: { tenantId: ctx.tenantId, active: true, ...(ctx.permissions.includes('knowledge.manage') ? {} : { OR: [{ ownerMembershipId: ctx.membershipId }, ...(!write ? [{ visibility: 'tenant' }] : []), { grants: { some: { ...(write ? { access: 'write' } : {}), OR: [{ subjectType: 'member', subjectId: ctx.membershipId }, { subjectType: 'org', subjectId: { in: orgIds } }] } } }] }) }, orderBy: { createdAt: 'desc' } });
  }
  private async space(ctx: RequestContext, id: string, write = false) { const space = (await this.allowedSpaces(ctx, write)).find(x => x.id === id); if (!space) throw new NotFoundException('知识空间不存在或无权访问'); return space; }
  private async validateGrants(ctx: RequestContext, owner: string, grants: z.infer<typeof grantSchema>[]) {
    if (!await this.db.membership.findFirst({ where: { tenantId: ctx.tenantId, id: owner, active: true } })) throw new BadRequestException('知识 Owner 不可用');
    const unique = new Set<string>();
    for (const grant of grants) {
      const key = `${grant.subjectType}:${grant.subjectId}`; if (unique.has(key)) throw new BadRequestException('授权对象重复'); unique.add(key);
      const valid = grant.subjectType === 'member' ? await this.db.membership.findFirst({ where: { id: grant.subjectId, tenantId: ctx.tenantId, active: true } }) : await this.db.orgUnit.findFirst({ where: { id: grant.subjectId, tenantId: ctx.tenantId, active: true } });
      if (!valid) throw new BadRequestException('授权对象必须属于当前企业');
    }
  }
  async spaces(ctx: RequestContext) {
    const [spaces, writable] = await Promise.all([this.allowedSpaces(ctx), this.allowedSpaces(ctx, true)]);
    return spaces.map(x => ({ ...x, canWrite: writable.some(y => y.id === x.id), canManage: ctx.permissions.includes('knowledge.manage') || x.ownerMembershipId === ctx.membershipId }));
  }
  async createSpace(ctx: RequestContext, raw: unknown) {
    await this.current(ctx); this.auth.require(ctx, 'knowledge.manage');
    const input = readBody(spaceInput, raw); const owner = input.ownerMembershipId ?? ctx.membershipId;
    await this.validateGrants(ctx, owner, input.grants);
    return this.db.$transaction(async tx => {
      const space = await tx.knowledgeSpace.create({ data: { tenantId: ctx.tenantId, name: input.name, description: input.description, visibility: input.visibility, ownerMembershipId: owner } });
      await tx.knowledgeGrant.createMany({ data: input.grants.map(x => ({ ...x, tenantId: ctx.tenantId, spaceId: space.id })) });
      await tx.auditEvent.create({ data: this.audit(ctx, 'platform.knowledge.space.create', space.id) }); return space;
    });
  }
  async spaceDetails(ctx: RequestContext, id: string) {
    const space = await this.space(ctx, id);
    if (!ctx.permissions.includes('knowledge.manage') && space.ownerMembershipId !== ctx.membershipId) return { ...space, grants: [] };
    return { ...space, grants: await this.db.knowledgeGrant.findMany({ where: { tenantId: ctx.tenantId, spaceId: id } }) };
  }
  async accessOptions(ctx: RequestContext, id: string) {
    const space = await this.space(ctx, id);
    if (!ctx.permissions.includes('knowledge.manage') && space.ownerMembershipId !== ctx.membershipId) throw new NotFoundException('无权管理空间');
    const [members, orgs] = await Promise.all([this.db.membership.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, role: true, active: true, user: { select: { name: true } } } }), this.db.orgUnit.findMany({ where: { tenantId: ctx.tenantId, active: true } })]);
    return { members, orgs };
  }
  async updateSpace(ctx: RequestContext, id: string, raw: unknown) {
    const old = await this.space(ctx, id);
    if (!ctx.permissions.includes('knowledge.manage') && old.ownerMembershipId !== ctx.membershipId) throw new NotFoundException('无权管理知识空间');
    const input = readBody(spaceInput.extend({ version: z.int().positive(), active: z.boolean().default(true) }), raw);
    const owner = input.ownerMembershipId ?? old.ownerMembershipId; await this.validateGrants(ctx, owner, input.grants);
    return this.db.$transaction(async tx => {
      const changed = await tx.knowledgeSpace.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version }, data: { name: input.name, description: input.description, visibility: input.visibility, ownerMembershipId: owner, active: input.active, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('空间已变化，请刷新');
      await tx.knowledgeGrant.deleteMany({ where: { spaceId: id, tenantId: ctx.tenantId } });
      await tx.knowledgeGrant.createMany({ data: input.grants.map(x => ({ ...x, tenantId: ctx.tenantId, spaceId: id })) });
      await tx.auditEvent.create({ data: this.audit(ctx, 'platform.knowledge.space.update', id) }); return { id, version: input.version + 1 };
    });
  }
  async documents(ctx: RequestContext, spaceId: string, query: unknown = {}) {
    await this.space(ctx, spaceId);
    const { page, pageSize } = readBody(z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }), query);
    const where = { tenantId: ctx.tenantId, spaceId, status: { not: 'deleted' } };
    const [docs, total] = await Promise.all([this.db.knowledgeDocument.findMany({ where, include: { versions: { select: { id: true, version: true, filename: true, mimeType: true, byteSize: true, createdAt: true, indexes: { select: { status: true, errorCode: true, updatedAt: true, bindingId: true, bindingVersion: true } } }, orderBy: { version: 'desc' } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }), this.db.knowledgeDocument.count({ where })]);
    const binding = await this.infra.binding(ctx.tenantId, 'knowledge').catch(() => null);
    return { items: docs.map(doc => ({ ...doc, versions: doc.versions.map(v => ({ ...v, indexes: undefined, processingError: binding ? v.indexes.find(i => i.bindingId === binding.id && i.bindingVersion === binding.version)?.errorCode ?? null : null, processingStatus: binding ? v.indexes.find(i => i.bindingId === binding.id && i.bindingVersion === binding.version)?.status ?? 'queued' : 'awaiting_engine' })) })), total, page, pageSize };
  }
  async upload(ctx: RequestContext, spaceId: string, raw: unknown, documentId?: string) {
    await this.space(ctx, spaceId, true);
    const input = readBody(uploadInput, raw); const file = decodeFile(input.filename, input.contentBase64);
    const binding = await this.infra.binding(ctx.tenantId, 'knowledge').catch(() => null);
    if (binding?.provider === 'native' && !nativeFormats.includes(input.filename.split('.').at(-1)?.toLowerCase() ?? '')) throw new BadRequestException('内置轻量知识库支持 PDF、DOCX、XLSX、UTF-8 文本及 PNG/JPEG 图片；其他格式请先转换');
    const key = await storeOriginal(file.bytes);
    try {
      return await this.db.$transaction(async tx => {
        const old = documentId ? await tx.knowledgeDocument.findFirst({ where: { id: documentId, tenantId: ctx.tenantId, spaceId, status: 'active' } }) : null;
        if (documentId && (!old || input.expectedVersion !== old.currentVersion)) throw new ConflictException('文档已变化，请刷新');
        const version = (old?.currentVersion ?? 0) + 1;
        const doc = old ? await tx.knowledgeDocument.update({ where: { id: old.id }, data: { title: input.title, currentVersion: version } }) : await tx.knowledgeDocument.create({ data: { tenantId: ctx.tenantId, spaceId, title: input.title, createdByMembershipId: ctx.membershipId } });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId+':quota'},0))`;
        const entitlement=await this.quota.entitlement(ctx.tenantId,tx);
        const stored=await tx.knowledgeDocumentVersion.aggregate({where:{tenantId:ctx.tenantId},_sum:{byteSize:true}});
        if(entitlement&&BigInt(stored._sum.byteSize??0)+BigInt(file.byteSize)>BigInt(entitlement.knowledgeBytes))throw new ConflictException('知识库存储额度不足');
        await tx.knowledgeDocumentVersion.create({ data: { tenantId: ctx.tenantId, documentId: doc.id, version, filename: input.filename, mimeType: file.mimeType, byteSize: file.byteSize, sha256: file.sha256, storageKey: key, createdByMembershipId: ctx.membershipId } });
        await tx.auditEvent.create({ data: this.audit(ctx, 'platform.knowledge.document.upload', doc.id) }); return { id: doc.id, currentVersion: version };
      }, { isolationLevel: 'Serializable' });
    } catch (error) { await removeOriginal(key); throw error; }
  }
  private async document(ctx: RequestContext, id: string, write = false) {
    const doc = await this.db.knowledgeDocument.findFirst({ where: { id, tenantId: ctx.tenantId, status: { not: 'deleted' } } });
    if (!doc) throw new NotFoundException('文档不存在'); await this.space(ctx, doc.spaceId, write); return doc;
  }
  async original(ctx: RequestContext, id: string, version: number) {
    await this.document(ctx, id);
    const file = await this.db.knowledgeDocumentVersion.findUnique({ where: { documentId_version: { documentId: id, version } } });
    if (!file) throw new NotFoundException('文档版本不存在');
    return { filename: file.filename, mimeType: file.mimeType, bytes: await readOriginal(file.storageKey) };
  }
  async state(ctx: RequestContext, id: string, raw: unknown) {
    const doc = await this.document(ctx, id, true);
    const input = readBody(z.object({ status: z.enum(['active', 'archived', 'deleted']), version: z.int().positive() }), raw);
    await this.db.$transaction(async tx => {
      const changed = await tx.knowledgeDocument.updateMany({ where: { id, tenantId: ctx.tenantId, currentVersion: input.version, status: doc.status }, data: { status: input.status } });
      if (!changed.count) throw new ConflictException('文档已变化，请刷新');
      if (input.status === 'deleted') {
        await tx.knowledgeIndex.updateMany({ where: { tenantId: ctx.tenantId, version: { documentId: id } }, data: { status: 'deleting', nextAttemptAt: null } });
        await tx.knowledgeCitation.updateMany({ where: { tenantId: ctx.tenantId, version: { documentId: id } }, data: { excerpt: '', locator: {} } });
      }
      await tx.auditEvent.create({ data: this.audit(ctx, `platform.knowledge.document.${input.status}`, id) });
    });
    if (input.status === 'deleted') for (const v of await this.db.knowledgeDocumentVersion.findMany({ where: { documentId: id } })) await removeOriginal(v.storageKey);
    return { id, status: input.status };
  }
  async reindex(ctx: RequestContext, id: string) {
    const doc = await this.document(ctx, id, true); const binding = await this.infra.binding(ctx.tenantId, 'knowledge');
    if (doc.status !== 'active') throw new ConflictException('请先恢复文档再重新索引');
    const version = await this.db.knowledgeDocumentVersion.findUniqueOrThrow({ where: { documentId_version: { documentId: id, version: doc.currentVersion } } });
    return this.db.$transaction(async tx => {
      const key = { versionId_bindingId_bindingVersion: { versionId: version.id, bindingId: binding.id, bindingVersion: binding.version } };
      const old = await tx.knowledgeIndex.findUnique({ where: key });
      if (old && ['running', 'parsing', 'deleting'].includes(old.status)) throw new ConflictException('文档正在处理，请等待当前任务结束');
      const index = await tx.knowledgeIndex.upsert({ where: key, create: { tenantId: ctx.tenantId, versionId: version.id, bindingId: binding.id, bindingVersion: binding.version, provider: binding.provider, bindingSnapshot: binding as unknown as Prisma.InputJsonValue }, update: { status: 'queued', attempts: 0, errorCode: null, nextAttemptAt: null } });
      await tx.auditEvent.create({ data: this.audit(ctx, 'platform.knowledge.document.reindex', id) }); return { status: index.status };
    }, { isolationLevel: 'Serializable' });
  }
  async search(ctx: RequestContext, raw: unknown) {
    const input = readBody(z.object({ query: z.string().trim().min(1).max(2000), spaceId: z.uuid().optional() }), raw);
    const spaces = (await this.allowedSpaces(ctx)).filter(x => !input.spaceId || x.id === input.spaceId);
    if (!spaces.length) return [];
    const binding = await this.infra.binding(ctx.tenantId, 'knowledge');
    const rows = await this.db.knowledgeIndex.findMany({ where: { tenantId: ctx.tenantId, bindingId: binding.id, bindingVersion: binding.version, status: 'ready', version: { document: { status: 'active', spaceId: { in: spaces.map(x => x.id) } } } }, include: { version: { include: { document: true } } } });
    const indexes = rows.filter(x => x.version.version === x.version.document.currentVersion && x.datasetId && x.externalDocumentId);
    if (indexes.length > 500) throw new ConflictException('检索范围超过 500 份文档，请缩小知识空间范围');
    if (!indexes.length) return [];
    const chunks = await this.registry.create(binding).retrieve(input.query, indexes.map(x => ({ datasetId: x.datasetId!, documentId: x.externalDocumentId! })), async () => {
      const authorized = await this.allowedSpaces(ctx); const current = await this.infra.binding(ctx.tenantId, 'knowledge');
      if (current.version !== binding.version || indexes.some(x => !authorized.some(s => s.id === x.version.document.spaceId))) throw new ConflictException('知识权限或引擎已变化，请重新检索');
      const active = await this.db.knowledgeDocument.findMany({ where: { tenantId: ctx.tenantId, status: 'active', id: { in: indexes.map(x => x.version.documentId) } }, select: { id: true, currentVersion: true } });
      if (indexes.some(x => !active.some(d => d.id === x.version.documentId && d.currentVersion === x.version.version))) throw new ConflictException('文档已变化，请重新检索');
    });
    const freshSpaces = await this.allowedSpaces(ctx);
    const currentBinding = await this.infra.binding(ctx.tenantId, 'knowledge');
    if (binding.version !== currentBinding.version) throw new ConflictException('知识引擎已切换，请重新检索');
    const citations = [];
    for (const chunk of chunks) {
      const index = indexes.find(x => x.externalDocumentId === chunk.source.documentId && x.datasetId === chunk.source.datasetId);
      if (!index || !freshSpaces.some(x => x.id === index.version.document.spaceId)) throw new ConflictException('知识权限已变化，请重新检索');
      const doc = await this.db.knowledgeDocument.findFirst({ where: { id: index.version.documentId, tenantId: ctx.tenantId, status: 'active', currentVersion: index.version.version } });
      if (!doc) throw new ConflictException('文档已变化，请重新检索');
      const hash = createHash('sha256').update(chunk.text + JSON.stringify(chunk.locator)).digest('hex');
      const citation = await this.db.knowledgeCitation.upsert({ where: { versionId_contentHash: { versionId: index.versionId, contentHash: hash } }, create: { tenantId: ctx.tenantId, versionId: index.versionId, contentHash: hash, excerpt: chunk.text, locator: chunk.locator as Prisma.InputJsonValue }, update: {} });
      citations.push({ id: citation.id, documentId: doc.id, spaceId: doc.spaceId, title: doc.title, version: index.version.version, excerpt: citation.excerpt, locator: citation.locator, ...(chunk.retrieval ? { retrieval: chunk.retrieval } : {}) });
    }
    return citations;
  }
  async citation(ctx: RequestContext, id: string) {
    const citation = await this.db.knowledgeCitation.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { version: true } });
    if (!citation) throw new NotFoundException('引用不存在');
    const doc = await this.document(ctx, citation.version.documentId);
    if (doc.status !== 'active') throw new NotFoundException('引用已归档');
    return { id: citation.id, title: doc.title, documentId: doc.id, version: citation.version.version, excerpt: citation.excerpt, locator: citation.locator };
  }
}
