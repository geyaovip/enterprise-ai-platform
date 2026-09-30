import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import type { AppAiProvider, AiResourceFacts } from '../ai/app-ai-provider';
import { ModelGateway } from '../ai/model.gateway';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { PurchaseService } from './purchase.service';
import { SalesService } from './sales.service';
import { FinanceService } from './finance.service';
import { MasterService } from './master.service';
import { InventoryService } from './inventory.service';

@Injectable()
export class ErpAiProvider implements AppAiProvider {
  readonly appId = 'erp';
  readonly usePermission = 'erp.ai.use';
  readonly analysisSystemPrompt = '你是 ERP 业务分析助手。只依据给定 JSON 事实回答，明确区分事实与建议；不得编造 SKU、库存、金额或交期。不要声称执行了业务操作。';
  readonly tools = {
    'erp.purchase.create_draft': { confirmationRequired: false },
    'erp.purchase.confirm': { confirmationRequired: true },
    'erp.purchase.receive': { confirmationRequired: true },
    'erp.contract.ship': { confirmationRequired: true },
    'erp.finance.record_payment': { confirmationRequired: true },
    'erp.customer.create': { confirmationRequired: false },
    'erp.opportunity.create': { confirmationRequired: false },
  };

  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly gateway: ModelGateway,
    private readonly purchases: PurchaseService,
    private readonly sales: SalesService,
    private readonly finance: FinanceService,
    private readonly master: MasterService,
    private readonly inventory: InventoryService,
  ) {}

  async resourceFacts(ctx: RequestContext, type: string, id?: string): Promise<AiResourceFacts> {
    if (type === 'purchase' && id) {
      const p = await this.purchases.get(ctx, id);
      const facts = p.lines.map(l => ({ sku: l.sku, ordered: l.quantity, received: l.receivedQty, remaining: Math.max(0, l.quantity - l.receivedQty) }));
      return { text: JSON.stringify({ type, id, number: p.number, status: p.status, version: p.version, total: p.total, facts }), facts, source: { appId: this.appId, type, id, version: p.version } };
    }
    if (type === 'contract' && id) {
      const c = await this.sales.get(ctx, id);
      const balances = await this.db.erpInventoryBalance.findMany({ where: { tenantId: ctx.tenantId, productId: { in: c.lines.map(l => l.productId) } } });
      const facts = c.lines.map(l => {
        const pending = Math.max(0, l.quantity - l.shippedQty);
        const balance = balances.find(b => b.productId === l.productId);
        const available = balance?.quantity ?? 0;
        return { sku: l.sku, pending, available, currentShortfall: Math.max(0, pending - available), balanceVersion: balance?.version ?? 0 };
      });
      return { text: JSON.stringify({ type, id, number: c.number, status: c.status, version: c.version, total: c.total, facts }), facts, source: { appId: this.appId, type, id, version: c.version } };
    }
    if (type === 'customer' && id) {
      const c = await this.master.customer(ctx, id);
      return { text: JSON.stringify({ type, id, code: c.code, name: c.name, active: c.active, opportunities: c.opportunities.map(x => ({ id: x.id, name: x.name, stage: x.stage })) }), source: { appId: this.appId, type, id } };
    }
    if (type === 'inventory') {
      this.auth.require(ctx, 'erp.inventory.read');
      const items = await this.db.erpInventoryBalance.findMany({ where: { tenantId: ctx.tenantId }, include: { product: { select: { sku: true, name: true, reorderPoint: true } } }, take: 50 });
      return { text: JSON.stringify({ type, items: items.map(x => ({ productId: x.productId, sku: x.product.sku, name: x.product.name, quantity: x.quantity, reorderPoint: x.product.reorderPoint, version: x.version })) }) };
    }
    return { text: '' };
  }

  async options(ctx: RequestContext): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    if (ctx.permissions.includes('erp.purchase.write')) {
      result.suppliers = await this.db.erpSupplier.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, code: true, name: true }, take: 50 });
    }
    if (ctx.permissions.includes('erp.master.read')) {
      result.products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, sku: true, name: true }, take: 50 });
    }
    return result;
  }

  canUse(ctx: RequestContext, tool: string): boolean {
    const permissions: Record<string, string> = {
      'erp.purchase.create_draft': 'erp.purchase.write',
      'erp.purchase.confirm': 'erp.purchase.approve',
      'erp.purchase.receive': 'erp.purchase.receive',
      'erp.contract.ship': 'erp.sales.ship',
      'erp.finance.record_payment': 'erp.finance.write',
      'erp.customer.create': 'erp.master.write',
      'erp.opportunity.create': 'erp.sales.write',
    };
    return tool in this.tools && ctx.permissions.includes(permissions[tool]);
  }

  async execute(ctx: RequestContext, tool: string, input: Record<string, unknown>): Promise<unknown> {
    if (!this.canUse(ctx, tool)) throw new ConflictException('当前无权执行此工具');
    if (tool === 'erp.purchase.create_draft') return this.purchases.create(ctx, input);
    if (tool === 'erp.purchase.confirm') return this.purchases.confirm(ctx, String(input.id), { version: input.version });
    if (tool === 'erp.purchase.receive') return this.purchases.receive(ctx, String(input.id), input);
    if (tool === 'erp.contract.ship') return this.sales.ship(ctx, String(input.id), input);
    if (tool === 'erp.finance.record_payment') return this.finance.payment(ctx, input.kind === 'receivable' ? 'receivable' : 'payable', String(input.id), input);
    if (tool === 'erp.customer.create') return this.master.createCustomer(ctx, input);
    if (tool === 'erp.opportunity.create') return this.master.createOpportunity(ctx, input);
    throw new ConflictException('工具不存在');
  }

  async shortages(ctx: RequestContext) {
    const items: Array<Awaited<ReturnType<InventoryService['alerts']>>['items'][number]> = [];
    for (let page = 1; ; page++) {
      const result = await this.inventory.alerts(ctx, { page, page_size: 100 });
      items.push(...result.items);
      if (page * 100 >= result.total) break;
    }
    return items.map(x => ({ productId: x.productId, sku: x.sku, name: x.name, quantity: x.quantity, reorderPoint: x.reorderPoint, incomingQty: x.incomingQty, status: x.status, suggestedMinimum: x.suggestedOrderQty, source: { appId: this.appId, type: 'inventory', id: x.productId, version: x.balanceVersion } }));
  }

  async extract(ctx: RequestContext, body: unknown) {
    const input = readBody(z.object({ kind: z.enum(['purchase', 'contract']), text: z.string().trim().min(10).max(12000) }), body);
    this.auth.require(ctx, input.kind === 'purchase' ? 'erp.purchase.write' : 'erp.sales.write');
    const raw = await this.gateway.complete(ctx, [
      { role: 'system', content: '从用户粘贴的文字中提取单据草稿，只返回 JSON，格式为 {"partyCode":"供应商或客户编号","lines":[{"sku":"商品SKU","quantity":正整数}],"note":"可选备注"}。不要编造不存在的字段；无法确定时用空字符串或空数组。' },
      { role: 'user', content: input.text },
    ]);
    let parsed: unknown;
    try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { throw new ServiceUnavailableException('模型提取结果不是有效 JSON'); }
    const draft = readBody(z.object({ partyCode: z.string().max(100), lines: z.array(z.object({ sku: z.string().max(100), quantity: z.int().positive() })).max(100), note: z.string().max(2000).optional() }), parsed);
    const skus = draft.lines.map(x => x.sku);
    const products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, sku: { in: skus }, active: true }, select: { id: true, sku: true, name: true } });
    const party = input.kind === 'purchase'
      ? await this.db.erpSupplier.findFirst({ where: { tenantId: ctx.tenantId, code: draft.partyCode, active: true }, select: { id: true, code: true, name: true } })
      : await this.db.erpCustomer.findFirst({ where: { tenantId: ctx.tenantId, code: draft.partyCode, active: true, ...(ctx.roles.includes('sales') ? { ownerMembershipId: ctx.membershipId } : {}) }, select: { id: true, code: true, name: true } });
    return { kind: input.kind, draft: { party, lines: draft.lines.map(x => ({ product: products.find(p => p.sku === x.sku) ?? null, sku: x.sku, quantity: x.quantity })), note: draft.note }, requiresReview: true, missingReferences: [...(!party ? [draft.partyCode] : []), ...draft.lines.filter(x => !products.some(p => p.sku === x.sku)).map(x => x.sku)] };
  }
}
