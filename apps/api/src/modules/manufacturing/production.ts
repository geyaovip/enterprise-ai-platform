import { z } from 'zod';
import { conflict, failNotFound, type Transaction } from '../erp/erp.common';
import type { RequestContext } from '../platform/context';
import { manufacturingPermissions } from './manufacturing.permissions';
import { productionAction } from './manufacturing.rules';

type Action = z.infer<typeof productionAction>;

export function findPlan(tx: Transaction, orderId: string) {
  return tx.manufacturingPlan.findUnique({ where: { orderId }, include: {
    jobs: { orderBy: { createdAt: 'asc' }, include: { reports: { orderBy: { createdAt: 'asc' } } } },
  } });
}

export function progress(plan: Awaited<ReturnType<typeof findPlan>>) {
  const reports = plan?.jobs.flatMap(j => j.reports) ?? [];
  const approved = reports.filter(r => r.status === 'approved');
  return {
    pending: reports.filter(r => r.status === 'pending').length,
    good: approved.reduce((n, r) => n + r.good, 0),
    defective: approved.reduce((n, r) => n + r.defective, 0),
  };
}

export async function runProduction(tx: Transaction, ctx: RequestContext, order: { id: string; quantity: number; completedQty: number }, input: Action) {
  const plan = await findPlan(tx, order.id);
  if (input.action === 'plan') {
    if (plan || order.completedQty) conflict('订单已有计划或成品入库记录');
    if (input.startDate > input.dueDate) conflict('计划完成日期不能早于开始日期');
    return tx.manufacturingPlan.create({ data: { orderId: order.id, startDate: input.startDate, dueDate: input.dueDate } });
  }
  if (!plan) failNotFound('生产计划');
  if ('version' in input && input.version !== plan.version) conflict('生产计划已变化，请刷新');
  if (input.action === 'release') {
    if (plan.status !== 'draft') conflict('只能发布草稿计划');
    return tx.manufacturingPlan.update({ where: { id: plan.id }, data: { status: 'released', version: { increment: 1 } } });
  }
  if (plan.status !== 'released') conflict('请先发布生产计划');
  const bump = () => tx.manufacturingPlan.update({ where: { id: plan.id }, data: { version: { increment: 1 } } });
  if (input.action === 'dispatch') {
    const member = await tx.membership.findFirst({ where: { id: input.assigneeId, tenantId: ctx.tenantId, active: true, user: { active: true } } });
    if (!member || !(await manufacturingPermissions(tx, ctx.tenantId, member.role, member.id)).includes('manufacturing.report'))
      conflict('请选择拥有报工权限的在职成员');
    const assigned = plan.jobs.reduce((n, j) => n + j.quantity, 0);
    if (assigned + input.quantity - progress(plan).defective > order.quantity)
      conflict('派工量超过剩余计划量。已审核不良可补派');
    const job = await tx.manufacturingJob.create({ data: { planId: plan.id, assigneeId: member.id, quantity: input.quantity, label: input.label } });
    await bump();
    return job;
  }
  if (input.action === 'cancel_job') {
    const job = plan.jobs.find(j => j.id === input.jobId);
    if (!job || job.reports.length) conflict('只能取消还没有报工记录的工单');
    await tx.manufacturingJob.delete({ where: { id: job.id } });
    await bump();
    return { id: job.id, cancelled: true };
  }
  if (input.action === 'report') {
    const job = plan.jobs.find(j => j.id === input.jobId);
    if (!job || job.assigneeId !== ctx.membershipId) failNotFound('本人受派工单');
    const used = job.reports.filter(r => r.status !== 'rejected').reduce((n, r) => n + r.good + r.defective, 0);
    const total = input.good + input.defective;
    if (!total || used + total > job.quantity) conflict('本次报工超过工单剩余数量，或未填写有效产量');
    const report = await tx.manufacturingReport.create({ data: {
      jobId: job.id, reporterId: ctx.membershipId, good: input.good, defective: input.defective, note: input.note,
    } });
    await bump();
    return report;
  }
  const report = plan.jobs.flatMap(j => j.reports).find(r => r.id === input.reportId);
  if (!report || report.status !== 'pending') conflict('报工已处理或不存在');
  if (report.reporterId === ctx.membershipId) conflict('报工人不能审核本人报工');
  if (input.decision === 'rejected' && !input.note) conflict('请填写退回原因');
  const reviewed = await tx.manufacturingReport.update({ where: { id: report.id }, data: {
    status: input.decision, reviewedAt: new Date(), reviewerId: ctx.membershipId, reviewNote: input.note,
  } });
  await bump();
  return reviewed;
}
