import { WorkflowService } from './workflow.service';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ROLE_PERMISSIONS } from './erp-permissions';

// Each pass advances across the whole collection; an old backlog cannot starve later records.
// Unique notification keys make retries and concurrent workers safe.
@Injectable()
export class ReminderService {
  private taskCursor: string | undefined;
  private opportunityCursor: string | undefined;
  private accountCursor:{receivable?:string;payable?:string}={};
  constructor(private readonly db: PrismaService,private readonly workflows:WorkflowService) {}

  async tick(now = new Date()) {
    await this.workflows.tick(now);
    const tasks = await this.db.erpTask.findMany({
      where: { status: 'open', dueAt: { lte: now }, ...(this.taskCursor ? { id: { gt: this.taskCursor } } : {}) },
      orderBy: { id: 'asc' }, take: 100, select: { id: true, tenantId: true, version: true },
    });
    for (const candidate of tasks) await this.db.$transaction(async tx => {
      const task = await tx.erpTask.findFirst({ where: { ...candidate, status: 'open', dueAt: { lte: now } } });
      if (!task) return;
      const member = await tx.membership.findFirst({ where: { id: task.assigneeMembershipId, tenantId: task.tenantId, active: true, user: { active: true }, tenant: { active: true, apps: { some: { appId: 'erp', granted: true, enabled: true } } } }, select: { role: true } });
      if (!member || !ROLE_PERMISSIONS[member.role]?.includes('erp.master.read')) return;
      await tx.erpNotification.createMany({ data: [{ tenantId: task.tenantId, recipientMembershipId: task.assigneeMembershipId, dedupeKey: `task_due:${task.id}:${task.version}`, title: `任务已到期：${task.title}`, body: `截止时间：${task.dueAt!.toISOString()}。请到“我的待办”查看并处理。` }], skipDuplicates: true });
    }, { isolationLevel: 'Serializable' });
    this.taskCursor = tasks.length === 100 ? tasks.at(-1)!.id : undefined;

    const opportunities = await this.db.erpOpportunity.findMany({
      where: { stage: { notIn: ['won', 'lost'] }, customer: { active: true }, ...(this.opportunityCursor ? { id: { gt: this.opportunityCursor } } : {}) },
      orderBy: { id: 'asc' }, take: 100, select: { id: true, tenantId: true },
    });
    for (const candidate of opportunities) await this.db.$transaction(async tx => {
      const opportunity = await tx.erpOpportunity.findFirst({ where: { ...candidate, stage: { notIn: ['won', 'lost'] }, customer: { active: true } }, include: { followups: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } } });
      const followup = opportunity?.followups[0];
      if (!opportunity || !followup?.nextActionAt || followup.nextActionAt > now) return;
      const member = await tx.membership.findFirst({ where: { id: opportunity.ownerMembershipId, tenantId: opportunity.tenantId, active: true, user: { active: true }, tenant: { active: true, apps: { some: { appId: 'erp', granted: true, enabled: true } } } }, select: { role: true } });
      if (!member || !ROLE_PERMISSIONS[member.role]?.includes('erp.sales.write')) return;
      await tx.erpNotification.createMany({ data: [{ tenantId: opportunity.tenantId, recipientMembershipId: opportunity.ownerMembershipId, dedupeKey: `followup_due:${followup.id}:${opportunity.ownerMembershipId}`, title: `商机跟进已到期：${opportunity.name}`, body: `跟进时间：${followup.nextActionAt.toISOString()}。请到“我的待办”记录新的跟进。` }], skipDuplicates: true });
    }, { isolationLevel: 'Serializable' });
    this.opportunityCursor = opportunities.length === 100 ? opportunities.at(-1)!.id : undefined;
    for(const kind of ['receivable','payable']as const){
      const where={status:{in:['open','partial']},dueAt:{lt:now},...(this.accountCursor[kind]?{id:{gt:this.accountCursor[kind]}}:{})};
      const accounts=kind==='receivable'?await this.db.erpReceivable.findMany({where,orderBy:{id:'asc'},take:100}):await this.db.erpPayable.findMany({where,orderBy:{id:'asc'},take:100});
      for(const a of accounts){if(!a.amount.gt(a.paidAmount))continue;await this.db.$transaction(async tx=>{const current=kind==='receivable'?await tx.erpReceivable.findUnique({where:{id:a.id}}):await tx.erpPayable.findUnique({where:{id:a.id}});if(!current?.dueAt||current.dueAt>=now||!current.amount.gt(current.paidAmount))return;const members=await tx.membership.findMany({where:{tenantId:a.tenantId,role:{in:['admin','finance']},active:true,user:{active:true},tenant:{active:true,apps:{some:{appId:'erp',granted:true,enabled:true}}}},select:{id:true}});await tx.erpNotification.createMany({data:members.map(m=>({tenantId:a.tenantId,recipientMembershipId:m.id,dedupeKey:`account_due:${kind}:${a.id}:${a.dueAt!.toISOString()}`,title:kind==='receivable'?'应收账款已逾期':'应付账款已逾期',body:`未结 ${current.amount.minus(current.paidAmount).toFixed(2)} 元，请到我的待办核对。`})),skipDuplicates:true});},{isolationLevel:'Serializable'});}
      this.accountCursor[kind]=accounts.length===100?accounts.at(-1)!.id:undefined;
    }

  }
}
