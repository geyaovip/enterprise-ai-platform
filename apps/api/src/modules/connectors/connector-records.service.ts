import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { ContentService } from '../content/content.service';
import { CrmTaskService } from '../crm/operation-task.service';
import { CorrectionService } from '../erp/correction.service';
import { label, money, positiveQty, storedMoney } from '../erp/erp.common';
import { MasterService } from '../erp/master.service';
import { PurchaseService } from '../erp/purchase.service';
import { checkApprover } from '../erp/trade.common';
import { GeoService } from '../geo/geo.service';
import { ManufacturingService } from '../manufacturing/manufacturing.service';
import { orderInput } from '../manufacturing/manufacturing.rules';
import { planDraft } from '../mes/mes.rules';
import { MesService } from '../mes/mes.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { recordPermission, type ConnectorApp } from './connector-policy';

const target = { id: z.uuid(), version: z.int().positive() };
const fields = z.record(z.string(), z.unknown());
export const recordChangeInput = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('create'), requestKey: z.uuid(), fields }),
  z.strictObject({ operation: z.literal('update'), requestKey: z.uuid(), ...target, fields }),
  z.strictObject({ operation: z.literal('delete'), requestKey: z.uuid(), ...target, reason: label(500) }),
]);
type Change = z.infer<typeof recordChangeInput>;
type Tx = Prisma.TransactionClient;
type Result = { id: string; number?: string; code?: string; title?: string; name?: string; status?: string; version: number };
type Plan = { parameters: Record<string, unknown>; route: string; execute: (requestKey: string) => Promise<Result> };

const purchaseCreate = z.strictObject({
  number: label(80), supplierId: z.uuid(),
  lines: z.array(z.strictObject({ productId: z.uuid(), quantity: positiveQty, unitPrice: money.optional() })).min(1).max(100)
    .refine(lines => new Set(lines.map(row => row.productId)).size === lines.length, '采购商品不能重复'),
});
const purchaseEdit = z.strictObject({
  note: z.string().max(2000).optional(),
  quantities: z.array(z.strictObject({ lineId: z.uuid(), quantity: positiveQty })).min(1).max(100)
    .refine(lines => new Set(lines.map(row => row.lineId)).size === lines.length, '采购明细不能重复').optional(),
});
const crmFields = {
  title: label(100), goal: z.string().max(1000).optional(), planText: z.string().max(10000).optional(),
};
const contentFields = { name: label(120), prompt: z.string().trim().min(1).max(2000) };
const manufacturingCreate = orderInput.omit({ requestKey: true, approvalRequired: true }).extend({ warehouseId: z.uuid() }).strict();

export const recordGuides: Record<ConnectorApp, string> = {
  erp: '采购草稿。新增 fields: number、supplierId、lines（productId、quantity、可选 unitPrice）；修改 fields: note 或 quantities（lineId、基础单位 quantity）；删除为取消本人未提交草稿，需采购审批权限。',
  crm: '运营任务草稿。新增 fields: title、可选 goal、planText；修改同名字段；删除为取消未提交草稿。',
  mes: '生产计划草稿。新增 fields: code、productId、bomId、targetQty、dueAt（带时区）、可选 note；修改 fields: targetQty、dueAt、note；删除为取消未发布计划，需计划发布权限。',
  geo: 'GEO 项目。新增 fields: name、brandName、可选 aliases、competitors、website、country、language、timezone；修改同名字段；删除为停用项目并保留历史报告。',
  content: '品牌内容项目。新增 fields: name、prompt（可填已定稿脚本）；修改同名字段；删除为移入工作台回收站。',
  manufacturing: '待审核制造订单。新增 fields: number、customerId、materialId、warehouseId、quantity、可选 dueDate；修改 fields: dueDate（日期或 null）；删除为取消本人待审核订单。',
};

function edit<T>(schema: z.ZodType<T>, raw: Record<string, unknown>): T {
  if (Object.keys(raw).length === 0) throw new BadRequestException('请提供要修改的字段');
  return readBody(schema, raw);
}

function requireVersion(row: { version: number }, version: number) {
  if (row.version !== version) throw new ConflictException('记录已变化，请重新查询后准备操作');
}

function plan(change: Change, title: string, effect: string, route: string, before: object | null, after: object,
  execute: Plan['execute']): Plan {
  const verb = { create: '新增', update: '修改', delete: '删除' }[change.operation];
  return {
    route, execute,
    parameters: { 操作: verb + title, 结果: effect, ...(before ? { 当前内容: before } : {}), 确认后: after,
      ...(change.operation === 'delete' ? { 原因: change.reason } : {}) },
  };
}

@Injectable()
export class ConnectorRecordsService {
  constructor(readonly master: MasterService, readonly purchase: PurchaseService, readonly correction: CorrectionService,
    readonly crm: CrmTaskService, readonly mes: MesService, readonly geo: GeoService,
    readonly content: ContentService, readonly manufacturing: ManufacturingService) {}

  authorize(ctx: RequestContext, app: ConnectorApp, change: Change) {
    if (ctx.app.appId !== app || !ctx.permissions.includes(recordPermission(app, change.operation)))
      throw new ForbiddenException('当前岗位无权办理此记录操作');
  }

  async inspect(tx: Tx, ctx: RequestContext, app: ConnectorApp, change: Change) {
    this.authorize(ctx, app, change);
    switch (app) {
      case 'erp': return this.erpPlan(tx, ctx, change);
      case 'crm': return this.crmPlan(tx, ctx, change);
      case 'mes': return this.mesPlan(tx, ctx, change);
      case 'geo': return this.geoPlan(tx, ctx, change);
      case 'content': return this.contentPlan(tx, ctx, change);
      case 'manufacturing': return this.manufacturingPlan(tx, ctx, change);
    }
  }

  private async erpPlan(tx: Tx, ctx: RequestContext, c: Change) {
    const route = '/erp/purchases';
    if (c.operation === 'create') {
      const data = readBody(purchaseCreate, c.fields);
      if (await tx.erpPurchaseOrder.findFirst({ where: { tenantId: ctx.tenantId, number: data.number }, select: { id: true } }))
        throw new ConflictException('采购单号已存在');
      const preview = await this.master.purchaseDraftPreview(ctx, data.supplierId, data.lines, tx);
      return plan(c, '采购草稿', '保存草稿', route, null, {
        单号: data.number, 供应商: preview.supplier.name, 明细: preview.lines, 预估合计: preview.estimatedTotal + ' CNY',
      }, () => this.purchase.createInTransaction(tx, ctx, data));
    }
    const order = await this.purchase.connectorDraft(tx, ctx, c.id, c.version);
    const before = { 单号: order.number, 供应商: order.supplier.name, 备注: order.note,
      合计: order.total.toFixed(2) + ' CNY', 明细: order.lines.map(row => ({
        商品: row.sku + ' · ' + row.name, 数量: row.quantity, 单位: row.baseUnit, 单价: row.unitPrice.toString(),
      })) };
    if (c.operation === 'delete') {
      await checkApprover(tx, ctx, 'purchase', order.total);
      return plan(c, '采购草稿', '取消草稿，保留单号和历史', route, before, { 状态: '已取消' }, async () => {
        await this.correction.closeOrderInTransaction(tx, ctx, 'purchase', c.id, c);
        return { id: c.id, number: order.number, version: c.version + 1, status: 'cancelled' };
      });
    }
    const data = edit(purchaseEdit, c.fields);
    const quantities = new Map(data.quantities?.map(row => [row.lineId, row.quantity]));
    if ([...quantities.keys()].some(id => !order.lines.some(row => row.id === id)))
      throw new BadRequestException('采购明细不属于当前草稿');
    const total = storedMoney(order.lines.reduce((sum, row) => {
      const quantity = quantities.get(row.id);
      return sum.plus(quantity === undefined ? row.lineTotal : storedMoney(row.unitPrice.mul(quantity)));
    }, new Prisma.Decimal(0)));
    return plan(c, '采购草稿', '保存草稿修改', route, before, {
      备注: data.note ?? order.note, 合计: total.toFixed(2) + ' CNY',
      明细: before.明细.map((row, i) => ({ ...row, 数量: quantities.get(order.lines[i].id) ?? row.数量 })),
    }, () => this.purchase.amendConnectorDraft(tx, ctx, c.id, c.version, data));
  }

  private async crmPlan(tx: Tx, ctx: RequestContext, c: Change) {
    const route = '/crm/tasks';
    if (c.operation === 'create') {
      const data = readBody(z.strictObject(crmFields), c.fields);
      return plan(c, '运营任务', '保存任务草稿', route, null, data,
        requestKey => this.crm.save(ctx, undefined, { ...data, requestKey }, { origin: 'ai' }, tx));
    }
    const task = await this.crm.get(ctx, c.id, 'crm.task.write', tx, true);
    requireVersion(task, c.version);
    if (task.status !== 'draft' || task.creatorMembershipId !== ctx.membershipId)
      throw new ConflictException('仅能处理本人创建的运营任务草稿');
    const before = { title: task.title, goal: task.goal, planText: task.plans[0]?.planText };
    if (c.operation === 'delete') {
      return plan(c, '运营任务', '取消草稿，保留任务和跟进历史', route, before, { 状态: '已取消' },
        requestKey => this.crm.actions(ctx, c.id, { action: 'cancel', requestKey, version: c.version, reason: c.reason }, tx));
    }
    const data = edit(z.strictObject(crmFields).partial(), c.fields);
    return plan(c, '运营任务', '保存草稿修改', route, before, { ...before, ...data },
      requestKey => this.crm.save(ctx, c.id, { ...data, version: c.version, requestKey }, { origin: 'ai' }, tx));
  }

  private async mesPlan(tx: Tx, ctx: RequestContext, c: Change) {
    const route = '/mes/plans';
    const old = c.operation === 'create' ? null : await this.mes.get(ctx, 'plan', c.id, tx);
    if (c.operation !== 'create') {
      requireVersion(old, c.version);
      if (old.status !== 'draft') throw new ConflictException('仅能处理未发布的生产计划');
    }
    const before = old && { 编号: old.code, 产品: old.productName, 目标量: old.targetQty, 截止时间: old.dueAt, 备注: old.note };
    if (c.operation === 'delete') {
      return plan(c, '生产计划', '取消未发布计划，保留计划历史', route, before, { 状态: '已取消' },
        requestKey => this.mes.planAction(ctx, c.id, { requestKey, version: c.version, action: 'cancel' }, tx));
    }
    const fields = c.operation === 'create' ? c.fields : {
      code: old.code, productId: old.productId, bomId: old.bomId, targetQty: old.targetQty,
      dueAt: old.dueAt.toISOString(), note: old.note,
      ...edit(z.strictObject({ targetQty: planDraft.shape.targetQty.optional(),
        dueAt: planDraft.shape.dueAt.optional(), note: z.string().trim().max(2000).optional() }), c.fields),
    };
    const draft = readBody(planDraft, fields);
    const preview = await this.mes.planPreview(ctx, draft, tx);
    return plan(c, '生产计划', '保存计划草稿', route, before, {
      编号: draft.code, 产品: preview.productName, 目标量: draft.targetQty, 截止时间: draft.dueAt, 备注: draft.note,
      BOM修订: preview.bomRevision, 用料: preview.requirements,
    }, requestKey => this.mes.savePlan(ctx, c.operation === 'create' ? undefined : c.id,
      { requestKey, draft, ...(c.operation === 'update' ? { version: c.version } : {}) }, tx));
  }

  private async geoPlan(tx: Tx, ctx: RequestContext, c: Change) {
    const route = '/geo/projects';
    if (c.operation === 'create') {
      const data = this.geo.connectorProjectInput(c.fields);
      return plan(c, 'GEO 项目', '新建项目配置', route, null, data,
        () => this.geo.saveProject(ctx, data, undefined, tx));
    }
    const old = await this.geo.project(ctx, c.id, tx);
    requireVersion(old, c.version);
    if (!old.active) throw new ConflictException('GEO 项目已停用');
    const before = { name: old.name, brandName: old.brandName, aliases: old.aliases, competitors: old.competitors,
      website: old.website, country: old.country, language: old.language, timezone: old.timezone };
    if (c.operation === 'delete') {
      const schedules = await tx.geoSchedule.findMany({
        where: { tenantId: ctx.tenantId, projectId: old.id, active: true },
        orderBy: { id: 'asc' }, select: { id: true, version: true },
      });
      return plan(c, 'GEO 项目', '停用项目与监测计划，保留已有分析报告', route, { ...before, 启用中的监测计划: schedules },
        { 状态: '已停用', 停用计划数: schedules.length },
        () => this.geo.archiveConnectorProject(ctx, c.id, c.version, tx));
    }
    const data = this.geo.connectorProjectInput(c.fields, before);
    return plan(c, 'GEO 项目', '更新项目配置', route, before, data,
      () => this.geo.saveProject(ctx, { ...data, version: c.version }, c.id, tx));
  }

  private async contentPlan(tx: Tx, ctx: RequestContext, c: Change) {
    const route = '/content/projects';
    if (c.operation === 'create') {
      const data = readBody(z.strictObject(contentFields), c.fields);
      return plan(c, '品牌内容项目', '保存私人创作项目', route, null, data, async () => {
        return this.content.saveProject(ctx, { name: data.name, brief: {
          workflow: 'studio', productIds: [], productVersions: {}, prompt: data.prompt, sizes: ['portrait'],
        } }, undefined, tx);
      });
    }
    const old = await this.content.project(ctx, c.id, true, tx);
    requireVersion(old, c.version);
    if (old.ownerId !== ctx.membershipId && !ctx.permissions.includes('content.manage'))
      throw new ForbiddenException('只有项目负责人或内容管理员可以办理此操作');
    const brief = old.brief as Record<string, unknown>;
    const before = { name: old.name, prompt: brief.prompt };
    if (c.operation === 'delete') {
      const queued = await tx.contentGenerationItem.findMany({
        where: { tenantId: ctx.tenantId, projectId: old.id, status: { in: ['queued','submitting','storing','rendering'] } },
        orderBy: { id: 'asc' }, select: { id: true, status: true },
      });
      return plan(c, '品牌内容项目', '移入回收站，并向未完成的生成任务发出取消请求', route,
        { ...before, 未完成任务: queued }, { 状态: '回收站', 取消请求数: queued.length }, async () => {
        await this.content.trashProject(ctx, c.id, false, tx, c.version);
        return { id: c.id, name: old.name, version: c.version + 1, status: 'trashed' };
      });
    }
    const data = edit(z.strictObject(contentFields).partial(), c.fields);
    const next = { ...before, ...data };
    return plan(c, '品牌内容项目', '更新项目草稿', route, before, next, () => this.content.saveProject(ctx, {
      version: c.version, name: next.name, visibility: old.visibility, participants: old.participants,
      brief: { ...brief, prompt: next.prompt },
    }, c.id, tx));
  }

  private async manufacturingPlan(tx: Tx, ctx: RequestContext, c: Change) {
    const route = '/manufacturing/orders';
    if (c.operation === 'create') {
      const data = readBody(manufacturingCreate, c.fields);
      if (await tx.manufacturingOrder.findFirst({ where: { tenantId: ctx.tenantId, number: data.number }, select: { id: true } }))
        throw new ConflictException('制造单号已存在');
      const draft = await this.manufacturing.orderDraft(tx, ctx, { ...data, requestKey: c.requestKey, approvalRequired: true });
      const warehouse = await tx.erpWarehouse.findUniqueOrThrow({ where: { id: draft.warehouseId }, select: { name: true } });
      return plan(c, '制造订单', '保存待审核接单', route, null, {
        单号: draft.number, 客户: draft.customerName, 产品: draft.productName, 数量: draft.quantity,
        交期: draft.dueDate, 仓库: warehouse.name, BOM修订: draft.bomRevision, 用料: draft.requirements,
      }, async requestKey => {
        const row = await this.manufacturing.createOrder(ctx, { ...data, requestKey, approvalRequired: true }, tx);
        return { ...row, status: row.salesStatus };
      });
    }
    const order = await this.manufacturing.pendingOrder(tx, ctx, c.id, c.version);
    const before = { 单号: order.number, 客户: order.customerName, 产品: order.productName, 数量: order.quantity, 交期: order.dueDate };
    if (c.operation === 'delete') {
      return plan(c, '制造订单', '取消待审接单，保留订单历史', route, before, { 状态: '已取消' }, async requestKey => {
        const row = await this.manufacturing.amendPendingOrder(ctx, c.id, { ...c, requestKey }, tx);
        return { ...row, status: row.salesStatus };
      });
    }
    const { dueDate } = readBody(z.strictObject({ dueDate: z.iso.date().nullable() }), c.fields);
    return plan(c, '制造订单', '更新待审订单交期', route, before, { 交期: dueDate }, async requestKey => {
      const row = await this.manufacturing.amendPendingOrder(ctx, c.id, { requestKey, version: c.version, operation: 'update', dueDate }, tx);
      return { ...row, status: row.salesStatus };
    });
  }
}
