import { ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, failNotFound, label, pageQuery } from './erp.common';

const taskInput = z.object({ requestKey: z.uuid(), title: label(160), description: z.string().trim().max(4000).default(''), assigneeMembershipId: z.uuid().optional(), dueAt: z.iso.datetime({ offset: true }).nullable().optional() });
const taskQuery = pageQuery.extend({id:z.uuid().optional(),status: z.enum(['open', 'completed', 'cancelled', 'all']).default('open') });
const taskStatus = z.object({ status: z.enum(['open', 'completed', 'cancelled']), version: z.int().positive() });
const announcementInput = z.object({ title: label(160), body: label(8000) });

@Injectable()
export class CollaborationService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}
  private member(ctx: RequestContext) { this.auth.require(ctx, 'erp.master.read'); }
  private admin(ctx: RequestContext) { this.member(ctx); if (!ctx.roles.includes('admin')) throw new ForbiddenException('仅管理员可执行此操作'); }
  private taskScope(ctx: RequestContext) { return ctx.roles.includes('admin') ? {} : { OR: [{ assigneeMembershipId: ctx.membershipId }, { createdByMembershipId: ctx.membershipId }] }; }
  async assignees(ctx: RequestContext) {
    this.member(ctx);
    return this.db.membership.findMany({ where: { tenantId: ctx.tenantId, active: true, user: { active: true }, ...(ctx.roles.includes('admin') ? {} : { id: ctx.membershipId }) }, select: { id: true, role: true, user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
  }
  async tasks(ctx: RequestContext, query: unknown) {
    this.member(ctx); const q = readBody(taskQuery, query);
    const where = { tenantId: ctx.tenantId,...(q.id?{id:q.id}:{}), ...this.taskScope(ctx), ...(q.status === 'all' ? {} : { status: q.status }), ...(q.q ? { title: { contains: q.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpTask.findMany({ where, include: { assignee: { select: { user: { select: { name: true } } } }, createdBy: { select: { user: { select: { name: true } } } } }, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpTask.count({ where }),
    ]); return { items, total, page: q.page, page_size: q.page_size };
  }
  async createTask(ctx: RequestContext, body: unknown) {
    this.member(ctx); const input = readBody(taskInput, body); const assigneeMembershipId = input.assigneeMembershipId ?? ctx.membershipId;
    if (assigneeMembershipId !== ctx.membershipId && !ctx.roles.includes('admin')) throw new ForbiddenException('只能为自己创建任务');
    return this.db.$transaction(async tx => {
      // Serialize retries of the same creation request before checking its canonical result.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}:${ctx.membershipId}:${input.requestKey}`}, 0))`;
      if (!await tx.membership.findFirst({ where: { id: assigneeMembershipId, tenantId: ctx.tenantId, active: true, user: { active: true } } })) failNotFound('在职任务执行人');
      const existing = await tx.erpTask.findUnique({ where: { tenantId_createdByMembershipId_requestKey: { tenantId: ctx.tenantId, createdByMembershipId: ctx.membershipId, requestKey: input.requestKey } } });
      if (existing) { if (existing.title !== input.title || existing.description !== input.description || existing.assigneeMembershipId !== assigneeMembershipId || existing.dueAt?.toISOString() !== (input.dueAt ? new Date(input.dueAt).toISOString() : undefined)) conflict('任务请求已使用，请刷新后重试'); return existing; }
      const task = await tx.erpTask.create({ data: { requestKey: input.requestKey, tenantId: ctx.tenantId, title: input.title, description: input.description, createdByMembershipId: ctx.membershipId, assigneeMembershipId, dueAt: input.dueAt ? new Date(input.dueAt) : null } });
      await tx.erpNotification.create({ data: { tenantId: ctx.tenantId, recipientMembershipId: assigneeMembershipId, dedupeKey: `task:${task.id}:1`, title: `新任务：${task.title}`, body: task.description } });
      await audit(tx, ctx, 'erp.task.create', 'Task', task.id, { assigneeMembershipId }); return task;
    });
  }
  async status(ctx: RequestContext, id: string, body: unknown) {
    this.member(ctx); const input = readBody(taskStatus, body);
    return this.db.$transaction(async tx => {
      const task = await tx.erpTask.findFirst({ where: { id, tenantId: ctx.tenantId, ...this.taskScope(ctx) } });
      if (!task) failNotFound('任务');
      const isAdmin = ctx.roles.includes('admin');
      if (input.status === 'completed' ? !isAdmin && task.assigneeMembershipId !== ctx.membershipId : !isAdmin && task.createdByMembershipId !== ctx.membershipId) throw new ForbiddenException('没有此任务状态操作权限');
      if (task.status === input.status || (task.status !== 'open' && input.status !== 'open')) conflict('任务状态已变化，请刷新');
      const changed = await tx.erpTask.updateMany({ where: { id, tenantId: ctx.tenantId, status: task.status, version: input.version }, data: { status: input.status, version: { increment: 1 } } });
      if (!changed.count) conflict('任务版本已变化，请刷新');
      const name = { open: '已重开', completed: '已完成', cancelled: '已取消' }[input.status];
      await tx.erpNotification.createMany({ data: [...new Set([task.assigneeMembershipId, task.createdByMembershipId])].map(recipientMembershipId => ({ tenantId: ctx.tenantId, recipientMembershipId, dedupeKey: `task:${id}:${input.version + 1}`, title: `任务${name}：${task.title}`, body: task.description })) });
      await audit(tx, ctx, `erp.task.${input.status}`, 'Task', id, { version: input.version + 1 });
      return tx.erpTask.findUniqueOrThrow({ where: { id } });
    });
  }
  async notifications(ctx: RequestContext, query: unknown) {
    this.member(ctx); const q = readBody(pageQuery, query); const where = { tenantId: ctx.tenantId, recipientMembershipId: ctx.membershipId };
    const [items, total, unread] = await this.db.$transaction([
      this.db.erpNotification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpNotification.count({ where }), this.db.erpNotification.count({ where: { ...where, readAt: null } }),
    ]);
    const ids=items.filter(i=>i.dedupeKey.startsWith('workflow:')).map(i=>i.dedupeKey.split(':')[1]);const flows=await this.db.erpWorkflow.findMany({where:{tenantId:ctx.tenantId,id:{in:ids}},select:{id:true,status:true}});const statuses=new Map(flows.map(f=>[f.id,f.status]));
    const claims=await this.db.erpReceiptClaim.findMany({where:{tenantId:ctx.tenantId,id:{in:items.filter(i=>i.dedupeKey.startsWith('receipt-claim:')).map(i=>i.dedupeKey.split(':')[1])}},select:{id:true,receiptId:true}});
    const followups=await this.db.erpOpportunityFollowup.findMany({where:{tenantId:ctx.tenantId,id:{in:items.filter(i=>i.dedupeKey.startsWith('followup_due:')).map(i=>i.dedupeKey.split(':')[1])}},select:{id:true,opportunityId:true}});
    const related=(i:any)=>{const claim=claims.find(c=>i.dedupeKey.split(':')[1]===c.id);const followup=followups.find(c=>i.dedupeKey.split(':')[1]===c.id);return claim?{relatedResource:{type:'receipt',id:claim.receiptId}}:followup?{relatedResource:{type:'opportunity',id:followup.opportunityId}}:{};};
    return { items:items.map(i=>({...i,...related(i),...(i.dedupeKey.startsWith('workflow:')?{workflowStatus:statuses.get(i.dedupeKey.split(':')[1])??'removed'}:{})})), total, unread, page: q.page, page_size: q.page_size };
  }
  async readNotification(ctx: RequestContext, id: string) {
    this.member(ctx); const where = { id, tenantId: ctx.tenantId, recipientMembershipId: ctx.membershipId };
    if (!await this.db.erpNotification.findFirst({ where })) failNotFound('通知');
    await this.db.erpNotification.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } }); return { read: true };
  }
  async announcements(ctx: RequestContext, query: unknown) {
    this.member(ctx); const q = readBody(pageQuery, query); const where = { tenantId: ctx.tenantId, active: true };
    const [items, total] = await this.db.$transaction([
      this.db.erpAnnouncement.findMany({ where, include: { reads: { where: { membershipId: ctx.membershipId }, select: { readAt: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpAnnouncement.count({ where }),
    ]); return { items: items.map(({ reads, ...item }) => ({ ...item, readAt: reads[0]?.readAt ?? null })), total, page: q.page, page_size: q.page_size };
  }
  async publish(ctx: RequestContext, body: unknown) {
    this.admin(ctx); const input = readBody(announcementInput, body);
    return this.db.$transaction(async tx => { const item = await tx.erpAnnouncement.create({ data: { ...input, tenantId: ctx.tenantId, createdByMembershipId: ctx.membershipId } }); await audit(tx, ctx, 'erp.announcement.publish', 'Announcement', item.id); return item; });
  }
  async withdraw(ctx: RequestContext, id: string) {
    this.admin(ctx);
    return this.db.$transaction(async tx => { const changed = await tx.erpAnnouncement.updateMany({ where: { id, tenantId: ctx.tenantId, active: true }, data: { active: false } }); if (!changed.count) failNotFound('有效公告'); await audit(tx, ctx, 'erp.announcement.withdraw', 'Announcement', id); return { active: false }; });
  }
  async readAnnouncement(ctx: RequestContext, id: string) {
    this.member(ctx);
    return this.db.$transaction(async tx => {
      if (!await tx.erpAnnouncement.findFirst({ where: { id, tenantId: ctx.tenantId, active: true } })) failNotFound('有效公告');
      await tx.erpAnnouncementRead.createMany({ data: [{ tenantId: ctx.tenantId, announcementId: id, membershipId: ctx.membershipId }], skipDuplicates: true });
      return tx.erpAnnouncementRead.findUniqueOrThrow({ where: { announcementId_membershipId: { announcementId: id, membershipId: ctx.membershipId } } });
    });
  }
}
