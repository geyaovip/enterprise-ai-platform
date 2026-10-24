import { infrastructureSecret, infrastructureEndpoint } from './infrastructure-contract';
export type { Binding } from './infrastructure-contract';
import { ManagedRuntimeService } from '../ai/managed-runtime.service';
import { RuntimeAdapterRegistry } from '../ai/runtime-registry';
import { KnowledgeEngineRegistry } from '../knowledge/engine-registry';
import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { addonProviders, addonRequest } from '../knowledge/knowledge-addons';
import { PrismaService } from '../prisma.service';
import { readBody } from './security';

const bindingInput = z.object({ provider: z.string().regex(/^[a-z0-9-]{1,60}$/), baseUrl: z.url(), secret: z.string().min(8).max(2000).optional(), enabled: z.boolean().default(true), version: z.int().nonnegative(), options: z.object({ agentId: z.string().regex(/^[a-z0-9_-]+$/).max(80).optional(), embeddingModel: z.string().max(150).optional(), embeddingFormat: z.enum(['openai', 'ark-multimodal']).optional(), model: z.string().trim().min(1).max(150).optional() }).default({}) });

@Injectable()
export class InfrastructureService {
  constructor(private readonly db: PrismaService, private readonly runtimes: RuntimeAdapterRegistry, private readonly engines: KnowledgeEngineRegistry, private readonly managed:ManagedRuntimeService) {}

  async binding(tenantId: string, kind: 'runtime' | 'knowledge', scopeKey = 'tenant') {
    const binding = await this.db.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId, kind, scopeKey } } });
    if (!binding?.enabled) throw new ServiceUnavailableException(kind === 'runtime' ? '你的 AI 助手尚未开通，请联系企业管理员。' : '企业文档搜索尚未开通，请联系企业管理员。');
    return binding;
  }

  adapters() { return { runtime: this.runtimes.providers(), knowledge: this.engines.providers() }; }

  async health(tenantId: string, id: string) {
    const binding = await this.db.infrastructureBinding.findFirst({ where: { id, tenantId } });
    if (!binding) throw new BadRequestException('环境不存在');
    const checkedAt = new Date().toISOString();
    if (!binding.enabled) return { id, version: binding.version, state: 'disabled', checkedAt };
    try {
      if(binding.kind==='runtime' && this.managed.enabled){const state=await this.managed.status({tenantId,membershipId:binding.scopeKey});if(state.managed&&['suspended','queued','preparing'].includes(state.state))return {id,version:binding.version,state:state.state,checkedAt};}
      if (addonProviders[binding.kind]) {
        await addonRequest(binding, binding.kind === 'knowledge-rerank' ? '/rerank' : '/chat/completions', binding.kind === 'knowledge-rerank' ? { model: (binding.options as { model?: string }).model, query: 'public connection check', documents: ['public connection check'], top_n: 1 } : { model: (binding.options as { model?: string }).model, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 4 });
      } else {
      const adapter = binding.kind === 'runtime' ? this.runtimes.create(binding) : this.engines.create(binding);
      await adapter.health();
      }
      const fresh = await this.db.infrastructureBinding.findUnique({ where: { id } });
      if (fresh?.version !== binding.version) return { id, version: binding.version, state: 'changed', checkedAt };
      return { id, version: binding.version, state: 'reachable', checkedAt };
    } catch (error) {
      const problem = error instanceof ServiceUnavailableException ? error.getResponse() : null;
      const detail = typeof problem === 'object' && problem !== null ? problem as { code?: string; message?: string } : null;
      return { id, version: binding.version, state: 'unavailable', checkedAt, ...(binding.kind === 'runtime' && detail?.code?.startsWith('RUNTIME_') ? { code: detail.code, message: detail.message } : {}) };
    }
  }

  async list(tenantId: string) {
    return this.db.infrastructureBinding.findMany({ where: { tenantId }, select: { id: true, kind: true, scopeKey: true, provider: true, baseUrl: true, options: true, version: true, enabled: true, updatedAt: true } });
  }

  async profiles(tenantId: string) {
    return this.db.knowledgeEngineProfile.findMany({ where: { tenantId }, select: { provider: true, baseUrl: true, options: true, version: true, updatedAt: true } });
  }
  async saveProfile(userId: string, tenantId: string, provider: string, raw: unknown) {
    const input = readBody(bindingInput, raw);
    if (input.provider !== provider || !this.engines.supports(provider) || !input.options.embeddingModel) throw new BadRequestException('知识引擎配置无效');
    const baseUrl = infrastructureEndpoint(input.baseUrl);
    return this.db.$transaction(async tx => {
      if (!await tx.tenant.findUnique({ where: { id: tenantId } })) throw new BadRequestException('企业不存在');
      const old = await tx.knowledgeEngineProfile.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
      if ((old?.version ?? 0) !== input.version) throw new ConflictException('方案配置已变化，请刷新');
      if (!old && !input.secret) throw new BadRequestException('首次配置需要凭据');
      const data = { baseUrl, options: input.options, secretCiphertext: input.secret ? infrastructureSecret(input.secret) : old!.secretCiphertext };
      const profile = await tx.knowledgeEngineProfile.upsert({ where: { tenantId_provider: { tenantId, provider } }, create: { tenantId, provider, ...data }, update: { ...data, version: { increment: 1 } } });
      await tx.operatorAudit.create({ data: { userId, tenantId, action: 'platform.knowledge.profile.configure', resourceId: profile.id, detail: { provider, version: profile.version } } });
      return { provider, version: profile.version };
    }, { isolationLevel: 'Serializable' });
  }

  async save(userId: string, tenantId: string, kind: string, scopeKey: string, raw: unknown) {
    const input = readBody(bindingInput, raw);
    const addon = addonProviders[kind];
    if (addon ? input.provider !== addon : kind !== 'runtime' && kind !== 'knowledge' || !(kind === 'runtime' ? this.runtimes.supports(input.provider) : this.engines.supports(input.provider))) throw new BadRequestException('组件类型不匹配或适配器未安装');
    const baseUrl = infrastructureEndpoint(input.baseUrl);
    if (kind === 'runtime') {
      if (!await this.db.membership.findFirst({ where: { id: scopeKey, tenantId, active: true } })) throw new BadRequestException('执行环境必须绑定当前企业的有效成员');
      if (input.enabled && !input.options.agentId) throw new BadRequestException('启用 AI 执行环境前必须指定助手标识');
      const current = await this.db.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId, kind, scopeKey } } });
      if ((current?.version ?? 0) !== input.version) throw new ConflictException('组件配置已变化，请刷新');
      if ((!current || current.provider !== input.provider) && !input.secret) throw new BadRequestException('首次配置需要凭据');
      if (await this.db.infrastructureBinding.findFirst({ where: { kind, baseUrl, ...(current ? { id: { not: current.id } } : {}) } })) throw new ConflictException('不同成员须使用独立 Gateway 地址，不能共享执行状态');
      if (await this.db.aiExecution.count({ where: { tenantId, membershipId: scopeKey, status: {in:['queued','preparing','running']} } })) throw new ConflictException('仍有执行中的任务，请排空后切换配置');
      // Probe outside the transaction. A failed activation preserves the old binding.
      // The transaction below rechecks version, member activity and running work.
      if (input.enabled) {
        const candidate = { id: current?.id ?? 'pending', tenantId, kind, scopeKey, provider: input.provider, baseUrl, enabled: true, version: input.version, options: input.options, secretCiphertext: input.secret ? infrastructureSecret(input.secret) : current!.secretCiphertext };
        await this.runtimes.create(candidate).health();
      }
    } else if (scopeKey !== 'tenant' || !(addon ? input.options.model : input.options.embeddingModel)) throw new BadRequestException('知识引擎必须按企业配置并指定嵌入模型');
    return this.db.$transaction(async tx => {
      if (!await tx.tenant.findUnique({ where: { id: tenantId } })) throw new BadRequestException('企业不存在');
      const old = await tx.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId, kind, scopeKey } } });
      if ((old?.version ?? 0) !== input.version) throw new ConflictException('组件配置已变化，请刷新');
      if ((!old || old.provider !== input.provider) && !input.secret) throw new BadRequestException('首次配置需要凭据');
      if (kind === 'runtime') {
        if (!await tx.membership.findFirst({ where: { id: scopeKey, tenantId, active: true } })) throw new BadRequestException('执行环境必须绑定当前企业的有效成员');
        const shared = await tx.infrastructureBinding.findFirst({ where: { kind, baseUrl, ...(old ? { id: { not: old.id } } : {}) } });
        if (shared) throw new ConflictException('不同成员须使用独立 Gateway 地址，不能共享执行状态');
        if (await tx.aiExecution.count({ where: { tenantId, membershipId: scopeKey, status: {in:['queued','preparing','running']} } })) throw new ConflictException('仍有执行中的任务，请排空后切换配置');
      }
      if (kind === 'knowledge' && old) await tx.knowledgeEngineProfile.upsert({ where: { tenantId_provider: { tenantId, provider: old.provider } }, create: { tenantId, provider: old.provider, baseUrl: old.baseUrl, secretCiphertext: old.secretCiphertext, options: old.options as any }, update: {} });
      const data = { provider: input.provider, baseUrl, enabled: input.enabled, options: input.options, secretCiphertext: input.secret ? infrastructureSecret(input.secret) : old!.secretCiphertext };
      const max = kind === 'knowledge' ? await tx.knowledgeEngineTransition.aggregate({ where: { tenantId }, _max: { targetVersion: true } }) : null;
      const nextVersion = Math.max(old?.version ?? 0, max?._max.targetVersion ?? 0) + 1;
      if (kind === 'knowledge') {
        await tx.knowledgeEngineProfile.upsert({ where: { tenantId_provider: { tenantId, provider: input.provider } }, create: { tenantId, provider: input.provider, baseUrl, secretCiphertext: data.secretCiphertext, options: input.options }, update: { baseUrl, secretCiphertext: data.secretCiphertext, options: input.options, version: { increment: 1 } } });
        await tx.knowledgeEngineTransition.updateMany({ where: { tenantId, status: 'building' }, data: { status: 'failed', errorCode: 'CONFIGURATION_CHANGED', finishedAt: new Date() } });
        // A direct operator reconfiguration invalidates reserved candidate generations.
        await tx.knowledgeIndex.updateMany({ where: { tenantId, bindingVersion: { gt: old?.version ?? 0 }, status: { notIn: ['deleted', 'deleting'] } }, data: { status: 'deleting', nextAttemptAt: null } });
      }
      const saved = old ? await tx.infrastructureBinding.update({ where: { id: old.id }, data: { ...data, version: nextVersion } }) : await tx.infrastructureBinding.create({ data: { ...data, tenantId, kind, scopeKey, version: nextVersion } });
      await tx.operatorAudit.create({ data: { userId, tenantId, action: 'platform.infrastructure.configure', resourceId: saved.id, detail: { kind, provider: input.provider, version: saved.version, enabled: saved.enabled } } });
      return { id: saved.id, version: saved.version, provider: saved.provider, enabled: saved.enabled };
    }, { isolationLevel: 'Serializable' });
  }
}
