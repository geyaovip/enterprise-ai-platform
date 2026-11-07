import {Injectable} from '@nestjs/common';
import type {RequestContext} from '../platform/context';
import {CrmCustomerService} from '../crm/customer.service';
import {CrmTaskService} from '../crm/operation-task.service';
import {CrmSegmentService} from '../crm/segment.service';
import {CrmEngagementService} from '../crm/engagement.service';
import {CrmGrowthService} from '../crm/growth.service';
import {problem} from '../crm/crm.common';
const pick=(r:any,keys:string[])=>Object.fromEntries(keys.filter(k=>r?.[k]!==undefined).map(k=>[k,r[k]]));
const page=(r:any,keys:string[],asOf:Date)=>({...pick(r,['total','page','page_size','metadata','summary','restricted','trackCustomers','notice','sourceLimit','truncated']),items:r.items.map((x:any)=>pick(x,keys)),asOf,hasMore:r.page*r.page_size<r.total,scope:'当前企业、岗位、组织、渠道和客户归属范围'});
const customerKeys=['id','displayName','status','kind','industry','region','channelIds','tagIds','recencyDays','frequency','monetary','lifetimeOrderCount','lifetimeNetAmount','lastPurchaseAt','sourceCreatedAt','version'];
const leadKeys=['id','name','companyName','contactMasked','source','requirement','status','ownerMembershipId','version','customerId','createdAt','channelId'];
const opportunityKeys=['id','name','customerId','customer','stage','estimatedAmount','currency','ownerMembershipId','nextAction','nextActionAt','expectedCloseAt','version','channelId'];
@Injectable()
export class CrmConnectorQueries {
 constructor(readonly customers:CrmCustomerService,readonly tasks:CrmTaskService,readonly segments:CrmSegmentService,readonly engagement:CrmEngagementService,readonly growth:CrmGrowthService){}
 async workbench(ctx:RequestContext){const r=await this.engagement.workbench(ctx);return {asOf:r.asOf,domains:{sales:ctx.permissions.includes('crm.sales.read'),followUps:ctx.permissions.includes('crm.followup.read'),service:ctx.permissions.includes('crm.service.read')},pendingLeads:r.pendingLeads,leads:r.leads,opportunities:r.opportunities,followUps:r.followUps.map((x:any)=>pick(x,['id','targetType','targetId','channelId','summary','nextAction','nextAt','doneAt'])),serviceTasks:r.serviceTasks.map((x:any)=>pick(x,['id','planId','plan','title','dueAt','status','version'])),risks:r.risks.map((x:any)=>pick(x,['id','customerId','customer','title','severity','status','version'])),displayedCounts:{followUps:r.followUps.length,overdueFollowUps:r.overdueFollowUps??0,serviceTasks:r.serviceTasks.length,opportunities:r.opportunities.length,risks:r.risks.length},complete:false,limits:{leadSamples:8,opportunities:20,followUpCandidates:100,serviceTasks:20,riskCandidates:20},notice:'本人工作台摘要：跟进、商机、服务和风险为有限展示子集；完整对象记录请使用各域分页工具，不能把展示数量当企业全量。'};}
 async pools(ctx:RequestContext,i:any){const r=await this.engagement.pools(ctx),items=r.items.map((x:any)=>pick(x,['id','name','orgUnitId','channelId','memberIds','active','version']));return {items:items.slice((i.page-1)*i.page_size,i.page*i.page_size),total:items.length,page:i.page,page_size:i.page_size,hasMore:i.page*i.page_size<items.length,asOf:this.now()};}
 private now(){return this.customers.core.now();}
 async customerList(ctx:RequestContext,i:any){return page(await this.customers.list(ctx,i),customerKeys,this.now());}
 async customerDetail(ctx:RequestContext,i:any){const r=await this.customers.detail(ctx,i.id,{currency:i.currency});return {...pick(r,customerKeys),contacts:r.contacts?.map((x:any)=>pick(x,['type','maskedValue'])),metric:r.metric,metadata:r.metadata,operationRecords:r.operationRecords,asOf:this.now(),notice:'联系方式仅脱敏展示；购买指标按所选币种计算。'};}
 async orders(ctx:RequestContext,i:any){const r=await this.customers.orders(ctx,i.customerId,i);return {...page(r,[],this.now()),items:r.items.map((o:any)=>({...pick(o,['id','customerId','externalOrderId','status','paidAt','paidAmount','refundAmount','currency','compensated','channel','version']),items:o.items.map((x:any)=>pick(x,['id','externalSkuId','name','quantity','paidAmount','refundAmount']))})),amountUnit:'主货币单位，十进制字符串；净购买须结合状态、退款、补偿和支付时间，不能把实付直接当营业额。'};}
 async segmentList(ctx:RequestContext,i:any){return page(await this.segments.list(ctx,i),['id','name','status','rule','ruleHash','templateId','version','updatedAt'],this.now());}
 async taskList(ctx:RequestContext,i:any){return page(await this.tasks.list(ctx,i),['id','title','goal','status','ownerMembershipId','dueAt','targetCount','currentPlanVersion','version','restricted','trackCustomers'],this.now());}
 async taskDetail(ctx:RequestContext,i:any){const r=await this.tasks.get(ctx,i.id);return {...pick(r,['id','title','goal','status','ownerMembershipId','dueAt','version','targetCount','restricted','trackCustomers','plans','logs','currentPlanVersion','confirmedPlanVersion','currency','baselineStart','baselineEnd','observationStart','observationEnd']),asOf:this.now()};}
 async taskCustomers(ctx:RequestContext,i:any){return {...await this.tasks.customerTargets(ctx,i.id,i),scope:'当前任务冻结目标与当前客户权限的交集'};}
 async leads(ctx:RequestContext,i:any){return page(await this.engagement.leads(ctx,i),leadKeys,this.now());}
 async lead(ctx:RequestContext,i:any){return {...pick(await this.engagement.getLead(ctx,i.id),leadKeys),asOf:this.now()};}
 async opportunities(ctx:RequestContext,i:any){return page(await this.engagement.opportunities(ctx,i),opportunityKeys,this.now());}
 async opportunity(ctx:RequestContext,i:any){return {...pick(await this.engagement.getOpportunity(ctx,i.id),opportunityKeys),asOf:this.now()};}
 async followUps(ctx:RequestContext,i:any){return page(await this.engagement.followUps(ctx,i),['id','targetType','targetId','channelId','occurredAt','summary','nextAction','nextAt','doneAt','version'],this.now());}
 async service(ctx:RequestContext,i:any){if(i.kind==='risks'&&i.endingWithinDays!==undefined||i.kind==='plans'&&i.status!==undefined)problem('INVALID_REQUEST','服务计划使用endingWithinDays；服务风险使用status。',400);if(i.kind==='risks')return page(await this.engagement.risks(ctx,i),['id','customerId','customer','title','severity','detail','status','resolution','closedAt','version'],this.now());const r=await this.engagement.plans(ctx,i);return {...page(r,['id','customerId','customer','title','status','startsAt','endsAt','ownerMembershipId','version'],this.now()),items:r.items.map((x:any)=>({...pick(x,['id','customerId','customer','title','status','startsAt','endsAt','ownerMembershipId','version']),tasks:x.tasks.map((t:any)=>pick(t,['id','title','dueAt','status','assigneeMembershipId','completionNote','reviewReason','version']))}))};}
}
