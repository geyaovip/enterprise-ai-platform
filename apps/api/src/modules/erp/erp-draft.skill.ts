import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { positiveQty } from './erp.common';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { ERP_PURCHASE_DRAFT_SKILL } from './erp-agent.definition';
import { AgentExecutionService } from '../ai/agent.runtime';
import { AuthService } from '../platform/auth.service';
import { MasterService } from './master.service';

const requestSchema = z.object({ kind: z.enum(['purchase', 'contract']), text: z.string().trim().min(10).max(12000) });
const draftSchema = z.object({ partyCode: z.string().max(100), lines: z.array(z.object({ sku: z.string().max(100), quantity: positiveQty })).max(100), note: z.string().max(2000).optional() });

@Injectable()
export class ErpDraftSkill {
  constructor(private readonly runtime: AgentExecutionService, private readonly master: MasterService, private readonly auth: AuthService) {}

  async extract(ctx: RequestContext, body: unknown) {
    const input = readBody(requestSchema, body);
    this.auth.require(ctx, input.kind === 'purchase' ? 'erp.purchase.write' : 'erp.sales.write');
    const purpose = input.kind === 'purchase' ? ERP_PURCHASE_DRAFT_SKILL.purpose : '从销售文字需求提取合同草稿，核对客户和商品，由用户复核后创建。';
    const raw = await this.runtime.complete({ request: ctx, sessionId: `extract:${ctx.requestId}` }, [
      { role: 'system', content: `${purpose}只返回 JSON，格式为 {"partyCode":"供应商或客户编号","lines":[{"sku":"商品SKU","quantity":最多六位小数的正数}],"note":"可选备注"}。不要编造不存在的字段；无法确定时用空字符串或空数组。` },
      { role: 'user', content: input.text },
    ],'document_extract');
    let parsed: unknown;
    try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { throw new ServiceUnavailableException('模型提取结果不是有效 JSON'); }
    const draft = readBody(draftSchema, parsed);
    const { party, products } = await this.master.draftReferences(ctx, input.kind, draft.partyCode, draft.lines.map(line => line.sku));
    return { kind: input.kind, draft: { party, lines: draft.lines.map(line => ({ product: products.find(product => product.sku === line.sku) ?? null, sku: line.sku, quantity: line.quantity })), note: draft.note }, requiresReview: true, missingReferences: [...(!party ? [draft.partyCode] : []), ...draft.lines.filter(line => !products.some(product => product.sku === line.sku)).map(line => line.sku)] };
  }
}
