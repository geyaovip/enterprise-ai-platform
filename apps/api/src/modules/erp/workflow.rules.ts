import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { ROLE_PERMISSIONS } from './erp-permissions';
import { approvalIds, type ApprovalConfig, conflict, label, money, type Transaction } from './erp.common';

export const workflowKinds = ['purchase', 'sales', 'purchase_change', 'return_purchase', 'return_sales', 'invoice', 'receipt'] as const;
export type WorkflowKind = typeof workflowKinds[number];
export const workflowNames: Record<WorkflowKind, string> = {purchase:'采购审核与入库',sales:'合同审核与发货',purchase_change:'采购变更审核',return_purchase:'采购退货审核',return_sales:'销售退货审核',invoice:'开票办理',receipt:'收款认领'};
export const approvalStepSchema = z.object({name:label(60),members:z.array(z.uuid()).min(1).max(20),mode:z.enum(['any','all','sequence']).default('any')});
export const workflowRuleSchema = z.object({
  steps:z.array(approvalStepSchema).max(8).default([]),threshold:money.optional(),highSteps:z.array(approvalStepSchema).max(8).default([]),
  handlers:z.array(z.uuid()).max(20).default([]),fallback:z.array(z.uuid()).max(20).default([]),cc:z.array(z.uuid()).max(30).default([]),
  hours:z.number().int().min(1).max(720).default(24),leadMinutes:z.number().int().min(0).max(1440).default(60),
  repeatHours:z.number().int().min(1).max(168).default(24),escalateHours:z.number().int().min(1).max(720).default(48),
  escalation:z.array(z.uuid()).max(20).default([]),
  delegation:z.object({from:z.uuid(),to:z.uuid(),until:z.iso.datetime()}).optional(),
}).refine(r=>!r.threshold||r.highSteps.length>0,'高金额规则需要审批步骤');
export const workflowConfigSchema=z.object(Object.fromEntries(workflowKinds.map(k=>[k,workflowRuleSchema.optional()])) as Record<WorkflowKind,z.ZodOptional<typeof workflowRuleSchema>>);
export type WorkflowRule=z.infer<typeof workflowRuleSchema>;
export type WorkflowConfig=Partial<Record<WorkflowKind,WorkflowRule>>;
export type FlowStep={name:string;type:'approval'|'handling';permission:string;members:string[];mode:'any'|'all'|'sequence';approved:string[];status:'waiting'|'active'|'completed'|'rejected'|'cancelled';enteredAt?:string;finishedAt?:string;dueAt?:string;assignee?:string;delegation?:{from:string;to:string;until:string}};
export type FlowEvent={at:string;action:string;actor?:string;note?:string;step?:number;from?:string[];to?:string[]};
export function approvalPermission(kind:WorkflowKind){return kind==='invoice'||kind==='receipt'?'erp.finance.write':`erp.${kind==='sales'||kind==='return_sales'?'sales':'purchase'}.approve`;}
export function handlerPermission(kind:WorkflowKind){return kind==='purchase'?'erp.purchase.receive':kind==='sales'?'erp.sales.ship':'erp.finance.write';}
export function currentActors(step:FlowStep){if(step.assignee)return[step.assignee];const remaining=step.members.filter(id=>!step.approved.includes(id));return step.mode==='sequence'?remaining.slice(0,1):remaining;}
export async function activeMembers(tx:Transaction,tenantId:string){return tx.membership.findMany({where:{tenantId,active:true,user:{active:true}},select:{id:true,role:true,user:{select:{name:true}}}});}
export async function resolveWorkflow(tx:Transaction,tenantId:string,kind:WorkflowKind,initiator:string,amount:Prisma.Decimal,skipApprovals=false){
 const settings=await tx.erpBusinessSettings.findUnique({where:{tenantId}});
 const configured=(settings?.workflowConfig??{}) as WorkflowConfig;
 const rule=workflowRuleSchema.parse(configured[kind]??{});
 const members=await activeMembers(tx,tenantId);const valid=new Set(members.map(m=>m.id));
 const fallback=rule.fallback.filter(id=>valid.has(id)&&id!==initiator);
 const approvals=kind!=='invoice'&&kind!=='receipt';
 let stages=skipApprovals?[]:rule.threshold&&amount.gte(rule.threshold)?rule.highSteps:rule.steps;
 if(approvals&&!skipApprovals&&!stages.length){const ids=approvalIds((settings?.approvalConfig??{})as ApprovalConfig,kind==='sales'||kind==='return_sales'?'sales':'purchase',amount);stages=[{name:'业务审核',members:ids.length?ids:members.filter(m=>m.role==='admin').map(m=>m.id),mode:'any'}];}
 const delegation=rule.delegation??((settings?.approvalConfig??{})as ApprovalConfig).delegation;
 const steps:FlowStep[]=stages.map(s=>{const proxy=delegation&&new Date(delegation.until)>new Date()&&s.members.includes(delegation.from)?delegation:undefined;const resolved=s.members.map(id=>proxy?.from===id?proxy.to:id);const missing=resolved.filter(id=>!valid.has(id)||id===initiator);if(s.mode!=='any'&&missing.length&&!fallback.length)conflict(`${s.name}的必需审批人失效或与发起人相同，请先配置备用审批人`);const recipients=s.mode==='any'?resolved.filter(id=>valid.has(id)&&id!==initiator):resolved.map(id=>valid.has(id)&&id!==initiator?id:fallback[0]);const ids=recipients.length?recipients:fallback;if(!ids.length)conflict(`${s.name}没有其他有效审批人，请配置审批人或备用审批人`);return{name:s.name,type:'approval',permission:approvalPermission(kind),members:[...new Set(ids)],mode:s.mode,approved:[],status:'waiting',...(proxy?{delegation:proxy}:{})};});
 if(kind==='purchase'||kind==='sales'||!approvals){const permission=handlerPermission(kind);const eligible=members.filter(m=>ROLE_PERMISSIONS[m.role]?.includes(permission)&&(!['invoice','receipt'].includes(kind)||m.id!==initiator));const allowed=new Set(eligible.map(m=>m.id));const ids=(rule.handlers.length?rule.handlers:eligible.map(m=>m.id)).filter(id=>allowed.has(id));if(!ids.length)conflict('没有有效办理人，请配置具有对应仓库或财务权限的成员');steps.push({name:kind==='purchase'?'采购入库':kind==='sales'?'销售发货':kind==='invoice'?'开票登记':'认领核对',type:'handling',permission,members:[...new Set(ids)],mode:'any',approved:[],status:'waiting'});}
 if(!steps.length)conflict('流程没有可办理节点');
 return{steps,rule,templateVersion:settings?.version??1};
}

export async function activeFlow(tx:Transaction,tenantId:string,kind:WorkflowKind,resourceId:string){return tx.erpWorkflow.findFirst({where:{tenantId,kind,resourceId,status:{in:['active','exception']}}});}
export async function assertFlowActor(tx:Transaction,tenantId:string,kind:WorkflowKind,resourceId:string,actor:string){
 const flow=await activeFlow(tx,tenantId,kind,resourceId);if(!flow)return null;
 if(flow.status==='exception')conflict('流程异常，请管理员先转交有效办理人');
 const step=(flow.steps as FlowStep[])[flow.cursor];if(step.delegation&&step.delegation.to===actor&&new Date(step.delegation.until)<=new Date())conflict('临时代理已到期，请等待重新分配');if(!currentActors(step).includes(actor))conflict('当前节点不由你处理，或你已完成本节点');
 return flow;
}
