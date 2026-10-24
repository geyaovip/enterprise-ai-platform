import {Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Prisma} from '../../generated/prisma/client';
import type {RequestContext} from '../platform/context';
import {CrmCore,type Db} from './crm-core.service';
import {amount,dec,dayDifference,hash,json,problem,subtractDays} from './crm.common';
import {prerequisite} from './crm-permissions';
import {defaultRule,normalizeRule,matches,type Rule} from './crm-rules';
@Injectable()
export class CrmMetricsService {
 constructor(readonly core:CrmCore){}
 async read(ctx:RequestContext,raw?:any,permission='crm.analytics.read',tx?:Db):Promise<any>{
  if(!tx)return this.core.db.$transaction(t=>this.read(ctx,raw,permission,t),{isolationLevel:'RepeatableRead',timeout:30000});
  const asOf=this.core.now(),settings=await this.core.settings(ctx,tx),rule=normalizeRule(raw??{...defaultRule(),currency:settings.currency},asOf),{bindings,access}=await this.core.bindings(ctx,permission,tx);
  if(!raw?.windowStart)rule.windowStart=subtractDays(new Date(rule.windowEnd!),settings.windowDays).toISOString();
  const scopeSql=async(p:string):Promise<Prisma.Sql>=>{const {bindings:bs}=await this.core.bindings(ctx,p,tx);const clauses=bs.map(b=>Prisma.sql`(${b.orgUnitIds==='all'?Prisma.sql`TRUE`:Prisma.sql`c."orgUnitId" IN (${Prisma.join(b.orgUnitIds)})`} AND ${b.channelIds==='all'?Prisma.sql`TRUE`:Prisma.sql`i."channelId" IN (${Prisma.join(b.channelIds)})`})`);const own=clauses.length?Prisma.sql`(${Prisma.join(clauses,' OR ')})`:Prisma.sql`FALSE`;const pres=await Promise.all((prerequisite[p]??[]).map(scopeSql));return Prisma.join([own,...pres],' AND ');};
  const visible=await scopeSql(permission);
  const valid=Prisma.sql`o.status IN ('paid','completed') AND NOT o.compensated AND o."paidAmount">o."refundAmount" AND o."paidAt"<${asOf}`;
  const inWindow=Prisma.sql`${valid} AND o."paidAt">=${new Date(rule.windowStart!)} AND o."paidAt"<${new Date(rule.windowEnd!)}`;
  const rows=await tx.$queryRaw(Prisma.sql`
   WITH visible AS (SELECT DISTINCT c.id,c."displayName",c."orgUnitId",c.status,c."sourceCreatedAt",c.version,i."channelId"
    FROM "CrmCustomer" c JOIN "CrmCustomerIdentity" i ON i."customerId"=c.id AND i."tenantId"=c."tenantId"
    WHERE c."tenantId"=${ctx.tenantId} AND (${visible}))
   SELECT v.id,v."displayName",v."orgUnitId",v.status,v."sourceCreatedAt",v.version,
    array_agg(DISTINCT v."channelId") AS "channelIds",
    ARRAY(SELECT a."tagId" FROM "CrmCustomerTagAssignment" a JOIN "CrmCustomerTag" t ON t.id=a."tagId" AND t."tenantId"=a."tenantId" WHERE a."tenantId"=${ctx.tenantId} AND a."customerId"=v.id AND t.status='active') AS "tagIds",
    COUNT(o.id) FILTER(WHERE ${valid})::int AS "lifetimeOrderCount",
    COUNT(o.id) FILTER(WHERE ${inWindow})::int AS frequency,
    COALESCE(SUM(o."paidAmount"-o."refundAmount") FILTER(WHERE ${valid}),0)::text AS "lifetimeNetAmount",
    COALESCE(SUM(o."paidAmount"-o."refundAmount") FILTER(WHERE ${inWindow}),0)::text AS monetary,
    COALESCE(SUM(o."refundAmount"),0)::text AS "refundAmount",
    MIN(o."paidAt") FILTER(WHERE ${valid}) AS "firstPurchaseAt",MAX(o."paidAt") FILTER(WHERE ${valid}) AS "lastPurchaseAt"
   FROM visible v LEFT JOIN "CrmCommerceOrder" o ON o."tenantId"=${ctx.tenantId} AND o."customerId"=v.id AND o."channelId"=v."channelId" AND o.currency=${rule.currency}
   GROUP BY v.id,v."displayName",v."orgUnitId",v.status,v."sourceCreatedAt",v.version ORDER BY v.id LIMIT 50001`);
  if(rows.length>50000)problem('CAPACITY_LIMIT','当前同步查询超过5万客户工程上限，请缩小授权范围或联系管理员。',413);
  const records=rows.map((r:any)=>({...r,monetary:amount(r.monetary),lifetimeNetAmount:amount(r.lifetimeNetAmount),refundAmount:amount(r.refundAmount),firstPurchaseAt:r.firstPurchaseAt?.toISOString()??null,lastPurchaseAt:r.lastPurchaseAt?.toISOString()??null,sourceCreatedAt:r.sourceCreatedAt?.toISOString()??null,recencyDays:r.lastPurchaseAt?dayDifference(asOf,r.lastPurchaseAt,settings.timezone):null,customerAgeDays:r.sourceCreatedAt?dayDifference(asOf,r.sourceCreatedAt,settings.timezone):null}));
  const channels=await this.core.visibleChannels(ctx,permission,tx),ids=channels.map((c:any)=>c.id),revisions=await tx.crmScopeRevision.findMany({where:{tenantId:ctx.tenantId,channelId:{in:ids}},orderBy:{channelId:'asc'}});
  const dependencyVersions=revisions.map((r:any)=>({channelId:r.channelId,sourceRevision:r.sourceRevision,customerRuleRevision:r.customerRuleRevision,generationId:r.metricGenerationId}));
  const pending=revisions.some((r:any)=>r.publishedSourceRevision!==r.sourceRevision||r.publishedRuleRevision!==r.customerRuleRevision||r.metricStatus!=='ready')||revisions.length<ids.length;
  const filtered=records.filter((r:any)=>matches(r,rule));
  return {records:filtered,normalizedRule:rule,ruleHash:hash(rule),metadata:{asOf:asOf.toISOString(),windowStart:rule.windowStart,windowEnd:rule.windowEnd,currency:rule.currency,timezone:settings.timezone,policyVersion:settings.metricPolicyVersion,dataRevision:settings.dataRevision,scopeFingerprint:access.fingerprint,dependencyVersions,metricGenerationId:hash(dependencyVersions),metricsStatus:pending?'pending':'ready',source:'CRM授权订单净额，实时一致性计算；非财务现金流'},allCount:records.length};
 }
 async overview(ctx:RequestContext,raw:any){const result=await this.read(ctx,raw),r=result.records;const sum=(field:string)=>amount(r.reduce((n:any,row:any)=>n.plus(row[field]),dec(0))),buyers=r.filter((x:any)=>x.frequency>0).length,repeat=r.filter((x:any)=>x.frequency>=2).length;return {...result,records:undefined,metricDefinitions:{frequency:'窗口有效订单数F',monetary:'窗口净消费M',lifetimeOrderCount:'历史有效订单数，不是窗口F',lifetimeNetAmount:'历史净消费，不是窗口M',repeatRate:'窗口复购客户÷窗口购买客户×100，单位%'},repeatRateUnit:'percent',repeatRateDisplay:buyers?amount(dec(repeat).div(buyers).mul(100))+'%':null,customerCount:r.length,newCustomers:r.filter((x:any)=>x.sourceCreatedAt&&x.sourceCreatedAt>=result.metadata.windowStart&&x.sourceCreatedAt<result.metadata.windowEnd).length,unknownSourceCreated:r.filter((x:any)=>!x.sourceCreatedAt).length,validOrders:r.reduce((n:number,x:any)=>n+x.frequency,0),netAmount:sum('monetary'),lifetimeNetAmount:sum('lifetimeNetAmount'),buyingCustomers:buyers,repeatCustomers:repeat,repeatRate:buyers?amount(dec(repeat).div(buyers).mul(100)):null,lifetimeRepeatCustomers:r.filter((x:any)=>x.lifetimeOrderCount>=2).length,rfm:[{name:'30天内购买',count:r.filter((x:any)=>x.recencyDays!==null&&x.recencyDays<=30).length},{name:'31～90天',count:r.filter((x:any)=>x.recencyDays>30&&x.recencyDays<=90).length},{name:'超过90天',count:r.filter((x:any)=>x.recencyDays>90).length},{name:'无有效购买',count:r.filter((x:any)=>x.recencyDays===null).length}]};}
 async recalculate(tenantId:string,channelId:string){
  await this.core.db.$transaction(async tx=>{
   await this.core.lock(tx,tenantId+':crm:channel:'+channelId);
   const channel=await tx.crmSalesChannel.findFirst({where:{id:channelId,tenantId}});if(!channel)return;
   const revision=await tx.crmScopeRevision.findUnique({where:{channelId}});if(!revision)return;
   if(await tx.crmImportBatch.count({where:{tenantId,channelId,status:{in:['queued','applying']}}}))return;
   const settings=await tx.crmSettings.upsert({where:{tenantId},create:{tenantId},update:{}});
   const asOf=this.core.now(),windowStart=subtractDays(asOf,settings.windowDays),generation=randomUUID();
   const values=await tx.$queryRaw(Prisma.sql`SELECT o."customerId",o.currency,COUNT(*) FILTER(WHERE o.status IN ('paid','completed') AND NOT o.compensated AND o."paidAmount">o."refundAmount")::int AS "lifetimeOrderCount",COALESCE(SUM(o."paidAmount"-o."refundAmount") FILTER(WHERE o.status IN ('paid','completed') AND NOT o.compensated AND o."paidAmount">o."refundAmount"),0)::text AS "lifetimeNetAmount" FROM "CrmCommerceOrder" o WHERE o."tenantId"=${tenantId} AND o."channelId"=${channelId} AND o."paidAt"<${asOf} GROUP BY o."customerId",o.currency`);
   for(const v of values as any[])await tx.crmMetricSnapshot.create({data:{tenantId,customerId:v.customerId,channelId,generationId:generation,currency:v.currency,windowStart,windowEnd:asOf,asOf,policyVersion:settings.metricPolicyVersion,sourceRevision:revision.sourceRevision,values:json(v)}});
   await tx.crmScopeRevision.update({where:{channelId},data:{metricGenerationId:generation,metricAsOf:asOf,publishedSourceRevision:revision.sourceRevision,publishedRuleRevision:revision.customerRuleRevision,metricStatus:'ready'}});
   await tx.crmImportBatch.updateMany({where:{tenantId,channelId,status:{in:['completed','partially_applied','cancelled','failed']}},data:{metricsStatus:'ready'}});
  },{timeout:30000});
 }
 async tick(){const rows=await this.core.db.crmScopeRevision.findMany({where:{metricStatus:{in:['queued','failed']}},take:2,orderBy:{updatedAt:'asc'}});for(const row of rows)try{await this.recalculate(row.tenantId,row.channelId);}catch{await this.core.db.crmScopeRevision.update({where:{channelId:row.channelId},data:{metricStatus:'failed'}});}}
}
