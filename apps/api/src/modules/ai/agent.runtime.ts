import { isManagementAi } from '../platform/management-ai';
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { InfrastructureService } from '../platform/infrastructure.service';
import { ModelGateway } from './model.gateway';
import { RuntimeAdapterRegistry } from './runtime-registry';
import { QuotaService } from '../orchestration/quota.service';
import { ManagedRuntimeService } from './managed-runtime.service';
import { AuthService } from '../platform/auth.service';
import type { AIExecutionContext } from './agent.definition';
import type { ThinkingMode } from './thinking-mode';
import { usageColumns, type RuntimeReceipt } from './runtime-usage';
import { assertInputBudget } from './input-budget';

export type RuntimeMessage = { role: 'system' | 'user' | 'assistant'; content: string; items?:Array<Record<string,unknown>> };
export type RuntimeTool = { id: string; description: string; parameters: unknown };
export type RuntimeEvent = { type:'tool_request'; toolId:string; callId:string };
export type RuntimePurpose = 'reply'|'context_summary'|'analysis'|'risk_review'|'document_extract';
export type RuntimeRequest = { context: AIExecutionContext; runId: string; messages: RuntimeMessage[]; tools?: RuntimeTool[]; signal: AbortSignal; thinkingMode?: ThinkingMode; purpose?: RuntimePurpose; onUsage?: (receipt:RuntimeReceipt)=>Promise<void>; onTextDelta?: (delta: string) => Promise<void>; onEvent?: (event:RuntimeEvent)=>Promise<void> };
export type RuntimeResult = RuntimeReceipt & { outputItems?:Array<Record<string,unknown>>; text: string; toolRequests: Array<{ toolId: string; callId: string; input: unknown }> };
export interface AgentRuntime {
  readonly provider: string;
  readonly capabilities: { streaming: boolean; clientTools: boolean; cancellation: boolean };
  execute(input: RuntimeRequest): Promise<RuntimeResult>;
  health(): Promise<void>;
}

@Injectable()
export class AgentExecutionService {
  private readonly active = new Map<string, AbortController>();
  constructor(private readonly db: PrismaService, private readonly infra: InfrastructureService, private readonly models: ModelGateway, private readonly registry: RuntimeAdapterRegistry, private readonly quota:QuotaService, private readonly managed:ManagedRuntimeService, private readonly auth:AuthService) {}

  async execute(context: AIExecutionContext, messages: RuntimeMessage[], tools?: RuntimeTool[], onTextDelta?: (delta: string) => Promise<void>, thinkingMode?: ThinkingMode, onModelStart?: () => Promise<void>, onEvent?: (event:RuntimeEvent)=>Promise<void>, purpose: RuntimePurpose = 'reply'): Promise<RuntimeResult> {
    assertInputBudget(messages,tools);
    const legacyTest = process.env.NODE_ENV === 'test' && process.env.AGENT_RUNTIME_PROVIDER === 'test-model';
    let binding: Awaited<ReturnType<InfrastructureService['binding']>> | null = null;
    let admitted = false;
    const runId = randomUUID(); const controller = new AbortController(); let timeout: ReturnType<typeof setTimeout> | undefined;
    const requestedAt = Date.now();
    let modelStartedAt: number | undefined;
    let firstDeltaAt: number | undefined;
    let observed:RuntimeReceipt|undefined;
    let ledgerStarted=false,requested=false;
    const poll = setInterval(() => { void this.db.aiExecution.findUnique({where:{id:runId}}).then(async run => {
      if (run && !['queued','preparing','running'].includes(run.status)) controller.abort();
      if(context.request.requestId.startsWith('task:')) { const task=await this.db.aiTask.findUnique({where:{id:context.request.requestId.slice(5)}}); if(task?.status==='cancelled') controller.abort(); }
    }).catch(()=>controller.abort()); }, 1000);
    let beat: ReturnType<typeof setInterval> | undefined;
    this.active.set(runId, controller);
    try {
      await this.quota.reserve(context.request,'ai_run',runId);
      await this.db.aiModelUsage.create({data:{id:runId,tenantId:context.request.tenantId,membershipId:context.request.membershipId,appId:context.request.app.appId,sessionId:context.sessionId,requestId:context.request.requestId,source:legacyTest?'test-model':'openclaw',environment:process.env.NODE_ENV??'development',batchId:process.env.AI_USAGE_BATCH_ID,purpose}});
      ledgerStarted=true;
      await this.db.aiExecution.create({ data: { id: runId, tenantId: context.request.tenantId, membershipId: context.request.membershipId, sessionId: context.sessionId, requestId: context.request.requestId, provider: legacyTest ? 'test-model' : 'openclaw', status:'queued' } });
      if (!legacyTest) {
        if(this.managed.enabled) { binding = await this.managed.acquire(context.request,runId,controller.signal); admitted=Boolean(binding); }
        binding ??= await this.infra.binding(context.request.tenantId, 'runtime', context.request.membershipId);
      }
      const started=await this.db.aiExecution.updateMany({where:{id:runId,status:{in:['queued','preparing']}},data:{status:'running',bindingId:binding?.id,bindingVersion:binding?.version}});
      if(!started.count || controller.signal.aborted) throw new ConflictException('AI execution cancelled');
      timeout=setTimeout(()=>controller.abort(),thinkingMode === 'deep' ? 160000 : 60000);
      if(admitted)beat=setInterval(()=>{void this.managed.heartbeat(context.request,runId).catch(()=>controller.abort());},10000);
      modelStartedAt=Date.now();
      await onModelStart?.();
      requested=true;
      const observe=async(receipt:RuntimeReceipt)=>{observed={...observed,...receipt,usage:receipt.usage??observed?.usage};await this.db.aiModelUsage.update({where:{id:runId},data:usageColumns(observed)});};
      const result:RuntimeResult = binding ? await this.registry.create(binding).execute({ context, runId, messages, tools, thinkingMode, purpose, onUsage:observe, signal: controller.signal,onEvent,
        onTextDelta: onTextDelta ? async delta => { if (!firstDeltaAt && delta.trim()) firstDeltaAt = Date.now(); await onTextDelta(delta); } : undefined }) : { text: await this.models.complete(context.request, messages,observe), toolRequests: [] };
      // Capture usage before cancellation and authorization checks can reject delivery.
      await observe({externalId:result.externalId??observed?.externalId,model:result.model??observed?.model,requestedModel:result.requestedModel??observed?.requestedModel,usage:result.usage??observed?.usage});
      result.usage??=observed?.usage;
      const run = await this.db.aiExecution.findUnique({ where: { id: runId } });
      if (controller.signal.aborted || run?.status === 'cancelled') throw new ServiceUnavailableException('AI 执行已取消或超时');
      // Re-read delivery and membership before handing data/tool requests back to business code.
      const fresh = await this.db.membership.findFirst({ where: { id: context.request.membershipId, tenantId: context.request.tenantId, active: true, user: { active: true }, tenant: { active: true } } });
      const cap = await this.db.tenantCapability.findUnique({ where: { tenantId_capability: { tenantId: context.request.tenantId, capability: 'ai' } } });
      const app = await this.db.tenantApp.findUnique({ where: { tenantId_appId: { tenantId: context.request.tenantId, appId: context.request.app.appId } } });
      const latestBinding = binding ? await this.infra.binding(context.request.tenantId, 'runtime', context.request.membershipId) : null;
      if (binding && latestBinding?.version !== binding.version) throw new ConflictException('执行环境已变化，请重新发起');
      if (!fresh || fresh.role !== context.request.roles[0] || !cap?.delivered || !cap.enabled || (!isManagementAi(context.request.app.appId) && (!app?.granted || !app.enabled))) throw new ConflictException('执行期间权限或应用已变化，请重新发起');
      const permission=await this.auth.taskContext({tenantId:context.request.tenantId,userId:context.request.userId,membershipId:context.request.membershipId,appId:context.request.app.appId,taskId:runId});
      if(JSON.stringify([...permission.permissions].sort())!==JSON.stringify([...context.request.permissions].sort()))throw new ConflictException('执行期间权限已变化，请重新发起');
      const completed = await this.db.aiExecution.updateMany({ where: { id: runId, status: 'running' }, data: { status: 'completed', externalId: result.externalId,
        usage: { ...(result.usage ?? {}), purpose, thinkingMode: thinkingMode ?? 'deep', timing: { runtimeWaitMs: modelStartedAt-requestedAt, firstDeltaMs: firstDeltaAt ? firstDeltaAt-requestedAt : null, firstDeltaAt: firstDeltaAt ? new Date(firstDeltaAt).toISOString() : null, totalMs: Date.now()-requestedAt } }, finishedAt: new Date() } });
      if (!completed.count) throw new ConflictException('执行已取消或中断');
      await this.quota.settle(context.request,runId,result.usage);
      await this.db.aiModelUsage.update({where:{id:runId},data:{status:'completed',finishedAt:new Date(),...usageColumns(observed)}});
      return result;
    } catch (error) {
      const terminal=await this.db.aiExecution.findUnique({where:{id:runId},select:{status:true}});
      const status=controller.signal.aborted||terminal?.status==='cancelled'?'cancelled':'failed';
      const detail=error instanceof ServiceUnavailableException?error.getResponse():undefined;
      const errorCode=detail&&typeof detail==='object'?(typeof (detail as any).upstreamStatus==='number'?'RUNTIME_HTTP_'+(detail as any).upstreamStatus:(detail as any).code??'ServiceUnavailableException'):error instanceof Error?error.name:'UNKNOWN';
      const failureUsage={...observed?.usage,purpose,usageStatus:usageColumns(observed).usageStatus,timing:{runtimeWaitMs:modelStartedAt?modelStartedAt-requestedAt:null,firstDeltaMs:firstDeltaAt?firstDeltaAt-requestedAt:null,firstDeltaAt:firstDeltaAt?new Date(firstDeltaAt).toISOString():null,totalMs:Date.now()-requestedAt}};
      await this.db.aiExecution.updateMany({ where: { id: runId, status: {in:['queued','preparing','running']} }, data: { status, errorCode, usage:failureUsage,finishedAt:new Date() } });
      // A concurrent cancel has already made the execution terminal; retain its receipt too.
      if(observed)await this.db.aiExecution.updateMany({where:{id:runId,status:'cancelled'},data:{externalId:observed.externalId,usage:failureUsage}});
      if(ledgerStarted)await this.db.aiModelUsage.update({where:{id:runId},data:{status,errorCode,finishedAt:new Date(),...usageColumns(observed),...(!requested?{usageStatus:'not_requested'}:{})}});
      await this.quota.settle(context.request,runId,observed?.usage,'settled');
      throw error;
    } finally { clearTimeout(timeout); clearInterval(poll); clearInterval(beat); this.active.delete(runId); if(this.managed.enabled) await this.managed.release(context.request,runId).catch(()=>{}); }
  }

  async complete(context: AIExecutionContext, messages: RuntimeMessage[],purpose:RuntimePurpose='reply') {
    const result = await this.execute(context, messages,undefined,undefined,undefined,undefined,undefined,purpose);
    if (result.toolRequests.length) throw new ServiceUnavailableException('此任务不能执行工具');
    return result.text;
  }

  async runs(context: AIExecutionContext) { return this.db.aiExecution.findMany({ where: { tenantId: context.request.tenantId, membershipId: context.request.membershipId, sessionId: context.sessionId }, select: { id: true, status: true, errorCode: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 }); }

  async cancel(context: AIExecutionContext, runId: string) {
    const run = await this.db.aiExecution.findFirst({ where: { id: runId, tenantId: context.request.tenantId, membershipId: context.request.membershipId, sessionId: context.sessionId, status: {in:['queued','preparing','running']} } });
    if (!run) throw new ConflictException('执行已结束或无权访问');
    await this.db.aiExecution.updateMany({ where: { id: runId, status: {in:['queued','preparing','running']} }, data: { status: 'cancelled', finishedAt: new Date() } });
    this.active.get(runId)?.abort();
    return { status: 'cancelled' };
  }
}
