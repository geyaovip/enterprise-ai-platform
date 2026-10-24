import { isManagementAi } from '../platform/management-ai';
import { Injectable, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { request } from 'node:http';
import { PrismaService } from '../prisma.service';
import { infrastructureSecret } from '../platform/infrastructure-contract';
import { AuthService } from '../platform/auth.service';
import { ModelGateway } from './model.gateway';
import type { RequestContext } from '../platform/context';

type Admission = { state: string; available?: boolean; baseUrl?: string; secret?: string; agentId?: string; fastAgentId?: string; readAgentId?: string; ephemeralTurns?: boolean; queuePosition?: number };
type ManagedMembers = { members: Array<{ tenantId: string; membershipId: string; warm: boolean }> };

@Injectable()
export class ManagedRuntimeService {
  constructor(private readonly db: PrismaService, private readonly models: ModelGateway, private readonly auth:AuthService) {}
  get enabled() { return Boolean(process.env.RUNTIME_MANAGER_SOCKET); }
  private call(op: string, body: unknown): Promise<Admission> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = request({ socketPath: process.env.RUNTIME_MANAGER_SOCKET, path: '/' + op, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, timeout: 45000 }, res => {
        let raw = ''; res.on('data', data => { raw += data; if (raw.length > 20000) req.destroy(); });
        res.on('end', () => { try { if (res.statusCode !== 200) throw new Error(); resolve(JSON.parse(raw)); } catch { reject(new ServiceUnavailableException('AI 运行资源暂时无法分配，请稍后重试')); } });
      });
      req.on('timeout', () => req.destroy()); req.on('error', () => reject(new ServiceUnavailableException('AI 运行资源暂时不可用，请稍后重试')));
      req.end(payload);
    });
  }
  async status(ctx: Pick<RequestContext, 'tenantId' | 'membershipId'>) {
    if (!this.enabled) return { managed: false, available: false, state: 'manual' };
    const binding=await this.db.infrastructureBinding.findUnique({where:{tenantId_kind_scopeKey:{tenantId:ctx.tenantId,kind:'runtime',scopeKey:ctx.membershipId}}});
    if(binding&&!binding.enabled)return {managed:true,available:false,state:'disabled'};
    const [model, state] = await Promise.all([
      this.db.aiProviderSettings.count({ where: { tenantId: ctx.tenantId } }),
      this.call('status', { tenantId: ctx.tenantId, membershipId: ctx.membershipId }),
    ]);
    return { managed: true, available: Boolean(model || state.available), state: state.state };
  }
  async preparedMembers(): Promise<ManagedMembers['members']> {
    if (!this.enabled) return [];
    return (await this.call('list', {}) as unknown as ManagedMembers).members;
  }
  async prepare(ctx: RequestContext) {
    if (!this.enabled) return;
    const model = await this.models.runtimeSettings(ctx.tenantId);
    await this.call('prepare', { tenantId: ctx.tenantId, membershipId: ctx.membershipId, ...(model ? { model } : {}) });
  }
  async unprepare(ctx: Pick<RequestContext, 'tenantId' | 'membershipId'>) {
    if (this.enabled) await this.call('unprepare', ctx);
  }
  async acquire(ctx: RequestContext, runId: string, signal: AbortSignal) {
    const initial = await this.db.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId: ctx.tenantId, kind: 'runtime', scopeKey: ctx.membershipId } } });
    if (initial && (!initial.enabled || initial.provider !== 'openclaw')) return null;
    const state = await this.status(ctx);
    if (!state.available) return null;
    // A manually bound address is never silently replaced by a managed Gateway.
    if (initial && state.state === 'unprovisioned') return null;
    const model = await this.models.runtimeSettings(ctx.tenantId);
    const deadline = Date.now() + 240000;
    while (!signal.aborted && Date.now() < deadline) {
      const fresh = await this.db.membership.findFirst({ where: { id: ctx.membershipId, tenantId: ctx.tenantId, active: true, user: { active: true }, tenant: { active: true } } });
      const capability = await this.db.tenantCapability.findUnique({ where: { tenantId_capability: { tenantId: ctx.tenantId, capability: 'ai' } } });
      const app = await this.db.tenantApp.findUnique({ where: { tenantId_appId: { tenantId: ctx.tenantId, appId: ctx.app.appId } } });
      if (!fresh || fresh.role !== ctx.roles[0] || !capability?.enabled || !capability.delivered || (!isManagementAi(ctx.app.appId) && (!app?.enabled || !app.granted))) throw new ConflictException('执行权限已变化，请重新发起');
      if (isManagementAi(ctx.app.appId)) await this.auth.taskContext({...ctx,appId:ctx.app.appId,taskId:runId});
      const current=await this.db.infrastructureBinding.findUnique({where:{tenantId_kind_scopeKey:{tenantId:ctx.tenantId,kind:'runtime',scopeKey:ctx.membershipId}}});
      if(initial && (!current?.enabled || current.version!==initial.version))throw new ConflictException('运行配置已变化，请重新发起');
      const result = await this.call('acquire', { tenantId: ctx.tenantId, membershipId: ctx.membershipId, leaseId: runId, ...(model ? { model } : {}) });
      await this.db.aiExecution.updateMany({ where: { id: runId, status: { in: ['queued', 'preparing'] } }, data: { status: result.state === 'ready' ? 'preparing' : result.state === 'preparing' ? 'preparing' : 'queued' } });
      if (result.state === 'failed') throw new ServiceUnavailableException('AI 助手启动失败，请稍后重试或联系管理员');
      if (result.state === 'ready') {
        if (signal.aborted) throw new ConflictException('本次执行已停止');
        const runtimeOptions = { ...(result.fastAgentId ? { fastAgentId: result.fastAgentId } : {}), ...(result.readAgentId ? { readAgentId: result.readAgentId } : {}), ...(result.ephemeralTurns ? { ephemeralTurns: true } : {}) };
        if (initial) {
          if (initial.baseUrl !== result.baseUrl) throw new ConflictException('执行环境地址与受管实例不一致');
          return { ...initial, options: { ...(initial.options as Record<string, unknown>), ...runtimeOptions } };
        }
        // Unique member binding and a stable per-member alias. All model credentials
        // remain in the private Gateway config; only its token is stored encrypted.
        return this.db.$transaction(async tx => {
          const old = await tx.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId: ctx.tenantId, kind: 'runtime', scopeKey: ctx.membershipId } } });
          if (old) { if (!old.enabled || old.baseUrl !== result.baseUrl) throw new ConflictException('运行配置已变化'); return { ...old, options: { ...(old.options as Record<string, unknown>), ...runtimeOptions } }; }
          const binding = await tx.infrastructureBinding.create({ data: { tenantId: ctx.tenantId, scopeKey: ctx.membershipId, kind: 'runtime', provider: 'openclaw', baseUrl: result.baseUrl!, secretCiphertext: infrastructureSecret(result.secret!), options: { agentId: result.agentId!, ...runtimeOptions } } });
          await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action: 'platform.runtime.provision', resourceType: 'InfrastructureBinding', resourceId: binding.id } });
          return binding;
        });
      }
      await new Promise<void>(resolve => { const timer = setTimeout(done, 1000); function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); } signal.addEventListener('abort', done, { once: true }); });
    }
    throw new ServiceUnavailableException(signal.aborted ? '本次执行已停止' : 'AI 运行资源等待超时，请稍后重试');
  }
  async heartbeat(ctx: RequestContext, leaseId: string) { await this.call('acquire', { tenantId: ctx.tenantId, membershipId: ctx.membershipId, leaseId }); }
  async release(ctx: RequestContext, leaseId: string) { if (this.enabled) await this.call('release', { tenantId: ctx.tenantId, membershipId: ctx.membershipId, leaseId }); }
}
