import { z } from 'zod';
import { positiveQty } from './erp.common';
import type { ToolDefinition } from '../ai/app-ai-provider';

const target = z.object({ id: z.uuid(), version: z.int().positive() });
const batch = target.extend({ lines: z.array(z.object({ lineId: z.uuid(), quantity: positiveQty })).min(1).max(100), documentNumber: z.string().trim().min(1).max(80).optional(), note: z.string().max(2000).optional() });

export const ERP_AI_TOOLS: Record<string, ToolDefinition> = {
  'erp.workflow.create_replenishment_plan': {id:'erp.workflow.create_replenishment_plan',appId:'erp',permission:'erp.purchase.write',confirmationRequired:true,prompt:'生成补货采购计划；必须使用已提供的库存建议、supplierId 和商品 productId、quantity、snapshotHash。由用户到任务中心复核，之后提交企业审批并等待入库，不得自审或声称已入库。',input:z.object({number:z.string().trim().min(1).max(80),supplierId:z.uuid(),lines:z.array(z.object({productId:z.uuid(),quantity:positiveQty,snapshotHash:z.string().length(64)})).min(1).max(100)})},
  'erp.purchase.create_draft': {
    id: 'erp.purchase.create_draft', appId: 'erp', permission: 'erp.purchase.write', confirmationRequired: true,
    prompt: '创建采购草稿；需要 supplierId、lines:[{productId,quantity}]，数量为商品基础单位，最多六位小数；number 仅在用户明确给出时填写，否则由系统生成。只能使用当前已授权主数据中的 ID。',
    input: z.object({ number: z.string().trim().min(1).max(80).optional(), supplierId: z.uuid(), lines: z.array(z.object({ productId: z.uuid(), quantity: positiveQty })).min(1).max(100), note: z.string().max(2000).optional() }),
  },
  'erp.purchase.confirm': { id: 'erp.purchase.confirm', appId: 'erp', permission: 'erp.purchase.approve', confirmationRequired: true, prompt: '确认采购单；需要当前采购单 id、version。执行前用户再次确认。', input: target },
  'erp.purchase.receive': { id: 'erp.purchase.receive', appId: 'erp', permission: 'erp.purchase.receive', confirmationRequired: true, prompt: '办理采购入库；需要采购单 id、version、lines:[{lineId,quantity}]。必须逐行明确商品基础单位数量（最多六位小数），不允许省略 lines 触发整单入库。执行前用户再次确认。', input: batch },
  'erp.contract.ship': { id: 'erp.contract.ship', appId: 'erp', permission: 'erp.sales.ship', confirmationRequired: true, prompt: '办理销售出库；需要合同 id、version、lines:[{lineId,quantity}]。必须逐行明确商品基础单位数量（最多六位小数），不允许省略 lines 触发整单出库。执行前用户再次确认。', input: batch },
  'erp.finance.record_payment': {
    id: 'erp.finance.record_payment', appId: 'erp', permission: 'erp.finance.write', confirmationRequired: true,
    prompt: '登记真实收付款；需要应收/应付账款 id、kind(receivable/payable)、amount(金额字符串)、reference(真实凭证号)。缺少凭证号时只能提示用户补充。执行前用户再次确认。',
    input: z.object({ id: z.uuid(), kind: z.enum(['receivable', 'payable']), amount: z.string(), reference: z.string().trim().min(1) }),
  },
  'erp.customer.create': { id: 'erp.customer.create', appId: 'erp', permission: 'erp.master.write', confirmationRequired: false, prompt: '创建客户；需要用户明确给出的 code、name。', input: z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1) }) },
  'erp.opportunity.create': {
    id: 'erp.opportunity.create', appId: 'erp', permission: 'erp.sales.write', confirmationRequired: false,
    prompt: '创建商机；需要已授权客户 customerId、name、estimatedAmount(金额字符串)。不能猜测客户或金额。',
    input: z.object({ customerId: z.uuid(), name: z.string().trim().min(1), estimatedAmount: z.string() }),
  },
};
