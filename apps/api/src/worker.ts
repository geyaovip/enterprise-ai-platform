import {CrmMetricsService} from './modules/crm/metrics.service';
import {CrmImportService} from './modules/crm/import.service';
import { AiMemoryService } from './modules/ai/ai-memory.service';
import 'dotenv/config';
import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Prisma } from './generated/prisma/client';
import { AppModule } from './modules/app.module';
import { PrismaService } from './modules/prisma.service';
import { AuthService } from './modules/platform/auth.service';
import { KnowledgeProcessor } from './modules/knowledge/knowledge.processor';
import { AiService } from './modules/ai/ai.service';
import { ChannelRuntime } from './modules/platform/channel.runtime';
import { ReminderService } from './modules/erp/reminder.service';
import { TaskService } from './modules/orchestration/task.service';
import { ApplicationCollaborationService } from './modules/orchestration/collaboration.service';
import { OperatingEventService } from './modules/erp/operating-event.service';
import { ManagedRuntimeService } from './modules/ai/managed-runtime.service';
import { cleanupOcrTemps } from './modules/knowledge/native-ocr';

export async function processNextTask(db: PrismaService, auth: AuthService, ai: AiService): Promise<boolean> {
  const stale = new Date(Date.now() - 360_000);
  await db.aiExecution.updateMany({ where: { status: 'running', createdAt: { lt: stale } }, data: { status: 'interrupted', errorCode: 'EXECUTOR_INTERRUPTED', finishedAt: new Date() } });
  const task = await db.aiTask.findFirst({ where: { OR: [{ status: 'queued' }, { status: 'running', startedAt: { lt: stale } }] }, orderBy: { createdAt: 'asc' } });
  if (!task) return false;
  const claimed = await db.aiTask.updateMany({ where: { id: task.id, status: task.status, ...(task.status === 'running' ? { startedAt: task.startedAt } : {}) }, data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } } });
  if (!claimed.count) return true;
  if (task.attempts >= 3) {
    await db.aiTask.update({ where: { id: task.id }, data: { status: 'failed', errorCode: 'RETRY_LIMIT', finishedAt: new Date() } });
    return true;
  }
  const heartbeat = setInterval(()=>{void db.aiTask.updateMany({where:{id:task.id,status:'running'},data:{startedAt:new Date()}}).catch(()=>{});},10000);
  try {
    const ctx = await auth.taskContext({ tenantId: task.tenantId, userId: task.userId, membershipId: task.membershipId, appId: task.appId, taskId: task.id });
    const result = task.kind === 'analyze' ? await ai.analyze(ctx, task.input) : task.kind === 'extract' ? await ai.extract(ctx, task.input) : task.kind==='message' ? await ai.processMessageTask(ctx,task.input) : undefined;
    if (!result) throw new Error('UNKNOWN_TASK_KIND');
    await db.$transaction(async tx=>{
      const state=(result as any).failed?'failed':'completed';
      const changed=await tx.aiTask.updateMany({where:{id:task.id,status:'running'},data:{status:state,result:JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,finishedAt:new Date()}});
      if(changed.count)await tx.personalNotification.upsert({where:{tenantId_recipientMembershipId_dedupeKey:{tenantId:task.tenantId,recipientMembershipId:task.membershipId,dedupeKey:'ai:'+task.id}},create:{tenantId:task.tenantId,recipientMembershipId:task.membershipId,appId:task.appId,kind:task.kind==='message'?'conversation':'ai-task',resourceId:task.kind==='message'?(task.input as any).conversationId:task.id,dedupeKey:'ai:'+task.id,title:state==='completed'?'AI 助手已回复':'AI 请求未完成',body:state==='completed'?'回复已保存，点击查看。':'请打开会话查看处理结果。'},update:{}});
    });
  } catch (error) {
    await db.aiTask.updateMany({ where: { id: task.id,status:'running' }, data: { status: 'failed', errorCode: error instanceof Error ? error.name.slice(0, 80) : 'UNKNOWN', finishedAt: new Date() } });
  } finally {clearInterval(heartbeat);}
  return true;
}

export async function prepareMemberGateways(db: PrismaService, auth: AuthService, managed: ManagedRuntimeService) {
  if (!managed.enabled) return;
  const [members, apps, capabilities, bindings, prepared] = await Promise.all([
    db.membership.findMany({ where: { active: true, user: { active: true }, tenant: { active: true } }, select: { id: true, tenantId: true, userId: true } }),
    db.tenantApp.findMany({ where: { enabled: true, granted: true }, select: { tenantId: true, appId: true } }),
    db.tenantCapability.findMany({ where: { capability: 'ai', enabled: true, delivered: true }, select: { tenantId: true } }),
    db.infrastructureBinding.findMany({ where: { kind: 'runtime' }, select: { tenantId: true, scopeKey: true, enabled: true, provider: true } }),
    managed.preparedMembers(),
  ]);
  const capable = new Set(capabilities.map(cap => cap.tenantId));
  const known = new Set(prepared.map(row => row.membershipId));
  const eligible = new Set<string>();
  for (const member of members) {
    if (!capable.has(member.tenantId)) continue;
    const binding = bindings.find(row => row.tenantId === member.tenantId && row.scopeKey === member.id);
    // Existing manual Gateways remain under their own lifecycle and disabled
    // bindings must never be silently replaced by managed resources.
    if (binding && (!binding.enabled || binding.provider !== 'openclaw' || !known.has(member.id))) continue;
    for (const app of apps.filter(row => row.tenantId === member.tenantId)) {
      try {
        const ctx = await auth.taskContext({ tenantId: member.tenantId, membershipId: member.id, userId: member.userId, appId: app.appId, taskId: member.id });
        if (!ctx.permissions.includes(app.appId + '.ai.use')) continue;
        const status = await managed.status(ctx);
        if (!status.available) continue;
        eligible.add(member.id);
        await managed.prepare(ctx);
        break;
      } catch { /* another app may still authorize this member */ }
    }
  }
  for (const record of prepared) {
    if (record.warm && !eligible.has(record.membershipId)) {
      await managed.unprepare({ tenantId: record.tenantId, membershipId: record.membershipId });
    }
  }
}

async function main() {
  await cleanupOcrTemps();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const db = app.get(PrismaService);
  const auth = app.get(AuthService);
  const ai = app.get(AiService);
  const managed = app.get(ManagedRuntimeService);
  const knowledge = app.get(KnowledgeProcessor);
  const reminders = app.get(ReminderService);
  const channels = new ChannelRuntime(db, auth, ai);
  let stopping = false;
  const aiWorkerCount = Math.max(1, Math.min(4, Number(process.env.AI_TASK_WORKER_CONCURRENCY ?? 2) || 1));
  const lanes = [
    {name:'crm_imports',interval:1000,deadline:300000,run:()=>app.get(CrmImportService).tick()},
    {name:'crm_metrics',interval:2000,deadline:180000,run:()=>app.get(CrmMetricsService).tick()},
    {name:'crm_retention',interval:3600000,deadline:180000,run:()=>app.get(CrmImportService).cleanupExpired()},
    {name:'channel_sync',interval:10000,deadline:90000,run:()=>channels.sync()},
    {name:'channel_inbound',interval:1000,deadline:90000,run:()=>channels.processInbound()},
    {name:'channel_delivery',interval:1000,deadline:90000,run:()=>channels.processDelivery()},
    ...Array.from({length:aiWorkerCount},(_,index)=>({name:`ai_tasks_${index+1}`,interval:1000,deadline:360000,run:()=>processNextTask(db,auth,ai)})),
    {name:'ai_memory_cleanup',interval:10000,deadline:180000,run:()=>app.get(AiMemoryService).flushPurge()},
    {name:'ai_gateway_prepare',interval:30000,deadline:180000,run:()=>prepareMemberGateways(db,auth,managed)},
    {name:'knowledge',interval:1000,deadline:300000,run:()=>knowledge.tick()},
    {name:'reminders',interval:60000,deadline:120000,run:()=>reminders.tick()},
    {name:'operating_events',interval:60000,deadline:120000,run:()=>app.get(OperatingEventService).tick()},
    {name:'business_tasks',interval:1000,deadline:60000,run:()=>app.get(TaskService).tick()},
    {name:'application_events',interval:1000,deadline:60000,run:()=>app.get(ApplicationCollaborationService).tick()},
  ].map(l=>({...l,nextAt:0,startedAt:0,lastSuccess:Date.now(),active:null as Promise<void>|null}));
  let loopAt=Date.now();
  const health = createServer(async (req, res) => {
    if (req.url !== '/health') { res.writeHead(404).end(); return; }
    try {
      await db.$queryRaw`SELECT 1`;
      const ready=!stopping && Date.now()-loopAt<15000 && lanes.every(l=>(!l.active || Date.now()-l.startedAt<l.deadline)&&Date.now()-l.lastSuccess<l.deadline+l.interval);
      res.writeHead(ready?200:503,{'content-type':'application/json'}).end(JSON.stringify({ok:ready,database:'ready',lanes:lanes.map(l=>({name:l.name,running:Boolean(l.active),lastSuccess:new Date(l.lastSuccess).toISOString()}))}));
    } catch { res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, database: 'unavailable' })); }
  });
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 4602);
  await new Promise<void>(resolve => health.listen(port, process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', resolve));
  const shutdown = () => { stopping = true; };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Each bounded lane owns one in-flight operation. Slow OCR/model calls do not block notifications or other work.
  while(!stopping){
    loopAt=Date.now();
    for(const lane of lanes)if(!lane.active&&Date.now()>=lane.nextAt){
      lane.startedAt=Date.now();lane.nextAt=Date.now()+lane.interval;
      lane.active=Promise.resolve().then(async()=>{await lane.run();}).then(()=>{lane.lastSuccess=Date.now();}).catch(error=>{process.stderr.write(`[worker] ${lane.name} failed: ${error instanceof Error?error.name:'UnknownError'}\n`);}).finally(()=>{lane.active=null;});
    }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  await new Promise<void>(resolve=>health.close(()=>resolve()));
  await Promise.all(lanes.map(l=>l.active));
  await channels.close();
  await app.close();
}

if (require.main === module) void main().catch(error => { process.stderr.write(`[worker] startup failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`); process.exitCode = 1; });
