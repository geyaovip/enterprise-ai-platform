import { isManagementAi } from '../platform/management-ai';
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import type { RequestContext } from '../platform/context';
export type Entitlement={appIds:string[];seatLimit:number;aiRunLimit:number;taskLimit:number;knowledgeBytes:string;inputTokenPrice?:string|null;outputTokenPrice?:string|null;monthlyPrice:string};
@Injectable()
export class QuotaService{
 constructor(private readonly db:PrismaService){}
 // Custom enterprise channels never consume the platform's trial allowance.
 private async customModel(tenantId:string,tx:Prisma.TransactionClient){
  return Boolean(await tx.aiProviderSettings.count({where:{tenantId}}));
 }
 async chatSummary(ctx:Pick<RequestContext,'tenantId'|'userId'>,tx:Prisma.TransactionClient=this.db){
  if(await this.customModel(ctx.tenantId,tx))return {limit:null,used:0,remaining:null,period:'unlimited' as const};
  const used=await tx.aiChatTurn.count({where:{userId:ctx.userId,status:{not:'released'}}});
  return {limit:3,used,remaining:Math.max(0,3-used),period:'lifetime' as const};
 }
 async reserveChat(ctx:Pick<RequestContext,'tenantId'|'userId'>,turnKey:string,tx:Prisma.TransactionClient,taskId?:string){
  if(await this.customModel(ctx.tenantId,tx))return;
  const userId=ctx.userId;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'chat-trial:'+userId},0))`;
  const old=await tx.aiChatTurn.findUnique({where:{userId_turnKey:{userId,turnKey}}});
  if(old){if(old.status==='released')throw new ConflictException('这条请求已结束，请重新发送');return;}
  const summary=await this.chatSummary(ctx,tx);
  if(summary.period==='unlimited')return;
  if(summary.remaining===0)throw new ConflictException({code:'AI_CHAT_LIMIT_REACHED',message:'当前账号累计 3 次 AI 对话额度已用完。'});
  await tx.aiChatTurn.create({data:{userId,turnKey,taskId}});
 }
 async settleChat(userId:string,turnKey:string,consumed:boolean,tx:Prisma.TransactionClient=this.db){
  // Terminal transitions are monotonic, so retries cannot consume/refund twice.
  await tx.aiChatTurn.updateMany({where:{userId,turnKey,status:'reserved'},data:{status:consumed?'consumed':'released'}});
 }
 async entitlement(tenantId:string,tx:Prisma.TransactionClient=this.db){const subscription=await tx.tenantSubscription.findUnique({where:{tenantId}});if(!subscription)return null;if(subscription.status!=='active'||subscription.expiresAt<=new Date())throw new ConflictException('企业订阅已暂停或到期');return subscription.entitlement as Entitlement;}
 async reserve(ctx:RequestContext,metric:'ai_run'|'task',key:string,tx?:Prisma.TransactionClient){
  const run=async(t:Prisma.TransactionClient)=>{
   await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId+':quota'},0))`;
   const old=await t.usageRecord.findUnique({where:{tenantId_metric_requestKey:{tenantId:ctx.tenantId,metric,requestKey:key}}});if(old)return old;
   const ent=await this.entitlement(ctx.tenantId,t);if(ent){const start=new Date();start.setUTCDate(1);start.setUTCHours(0,0,0,0);const count=await t.usageRecord.count({where:{tenantId:ctx.tenantId,metric,createdAt:{gte:start},status:{not:'released'}}});const customModel=metric==='ai_run'&&await this.customModel(ctx.tenantId,t);if(!customModel&&count>=(metric==='ai_run'?ent.aiRunLimit:ent.taskLimit))throw new ConflictException('本月可用额度不足');if(ctx.app.appId!=='platform'&&!isManagementAi(ctx.app.appId)&&!ent.appIds.includes(ctx.app.appId))throw new ConflictException('套餐未包含当前应用');}
   return t.usageRecord.create({data:{tenantId:ctx.tenantId,appId:ctx.app.appId,membershipId:ctx.membershipId,metric,requestKey:key,quantity:1,status:metric==='task'?'settled':'reserved',detail:ent?{inputTokenPrice:ent.inputTokenPrice??null,outputTokenPrice:ent.outputTokenPrice??null}:undefined}});
  };return tx?run(tx):this.db.$transaction(run);
 }
 async settle(ctx:RequestContext,key:string,usage?:{inputTokens?:number;outputTokens?:number},status='settled'){
  const record=await this.db.usageRecord.findUnique({where:{tenantId_metric_requestKey:{tenantId:ctx.tenantId,metric:'ai_run',requestKey:key}}}),rates=record?.detail as Entitlement|undefined;
  const valid=usage&&Number.isFinite(usage.inputTokens)&&Number.isFinite(usage.outputTokens)&&usage.inputTokens! >= 0&&usage.outputTokens! >= 0;
  const cost=valid&&rates?.inputTokenPrice!=null&&rates.outputTokenPrice!=null?new Prisma.Decimal(usage!.inputTokens!).mul(rates.inputTokenPrice).plus(new Prisma.Decimal(usage!.outputTokens!).mul(rates.outputTokenPrice)).div(1000000).toDecimalPlaces(6):null;
  await this.db.usageRecord.updateMany({where:{tenantId:ctx.tenantId,metric:'ai_run',requestKey:key,status:'reserved'},data:{status,detail:usage?{...usage,rates:record?.detail??null}:undefined,cost}});
 }
 async checkSeat(tenantId:string,tx:Prisma.TransactionClient=this.db){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId+':quota'},0))`;const ent=await this.entitlement(tenantId,tx);if(ent&&await tx.membership.count({where:{tenantId,active:true}})>=ent.seatLimit)throw new ConflictException('成员席位已满');}
 async checkApp(tenantId:string,appId:string){const ent=await this.entitlement(tenantId);if(ent&&!ent.appIds.includes(appId))throw new ConflictException('套餐未包含此应用');}
 async summary(tenantId:string){
  const month=new Date();month.setUTCDate(1);month.setUTCHours(0,0,0,0);
  const where={tenantId,createdAt:{gte:month},status:{not:'released'}};
  const [subscription,bills,usage,seats,bytes,aiRuns,tasks,cost,missing]=await Promise.all([this.db.tenantSubscription.findUnique({where:{tenantId}}),this.db.manualBill.findMany({where:{tenantId},orderBy:{createdAt:'desc'},take:100}),this.db.usageRecord.findMany({where:{tenantId},orderBy:{createdAt:'desc'},take:100}),this.db.membership.count({where:{tenantId,active:true}}),this.db.knowledgeDocumentVersion.aggregate({where:{tenantId},_sum:{byteSize:true}}),this.db.usageRecord.count({where:{...where,metric:'ai_run'}}),this.db.usageRecord.count({where:{...where,metric:'task'}}),this.db.usageRecord.aggregate({where,_sum:{cost:true}}),this.db.usageRecord.count({where:{...where,metric:'ai_run',cost:null}})]);
  const plan=subscription?await this.db.servicePlan.findUnique({where:{code:subscription.planCode},select:{name:true}}):null;
  return{subscription:subscription?{...subscription,planName:plan?.name??subscription.planCode}:null,bills,seats,knowledgeBytes:bytes._sum.byteSize??0,month:month.toISOString(),aiRuns,tasks,knownCost:(cost._sum.cost??new Prisma.Decimal(0)).toFixed(6),costIncomplete:missing>0,usage};
 }
}
