import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContentService } from '../content/content.service';
import { generation } from '../content/content.rules';
import { GeoService } from '../geo/geo.service';
import { selection } from '../geo/geo.rules';
import { fingerprint } from '../orchestration/command-registry';
import type { RequestContext } from '../platform/context';
import { PrismaService } from '../prisma.service';
import { publicOrigin, type ExecutionConnectorApp } from './connector-policy';

export const contentQuoteInput = z.object({
  projectId: z.uuid(),
  request: generation.extend({mode:z.enum(['image','video'])}),
}).strict();
export const geoQuoteInput = z.object({
  projectId: z.uuid(),
  selection,
}).strict();
const commands = {content:'content.connector.generate',geo:'geo.connector.analyze'};
type QuoteInput = z.infer<typeof contentQuoteInput> | z.infer<typeof geoQuoteInput>;
const requestKey = (quoteId: string) => 'workbuddy:' + quoteId;

@Injectable()
export class ConnectorExecutionService {
  constructor(readonly db:PrismaService,readonly content:ContentService,readonly geo:GeoService){}

  private async saveQuote(app:ExecutionConnectorApp,grantId:string,ctx:RequestContext,input:QuoteInput,nativeHash:string,expiresAt:Date){
    const id=randomUUID();
    const digest=fingerprint({input,nativeHash});
    await this.db.connectorAction.create({data:{
      id,grantId,tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:app,
      command:commands[app],requestKey:requestKey(id),input,preview:{nativeHash},
      fingerprint:digest,requestFingerprint:digest,expiresAt,
    }});
    return {quoteId:id,expiresAt};
  }

  async contentQuote(grantId:string,ctx:RequestContext,input:z.infer<typeof contentQuoteInput>){
    const plan=await this.content.plan(ctx,input.projectId,input.request);
    const quote=await this.saveQuote('content',grantId,ctx,input,plan.previewHash,new Date(plan.expiresAt));
    return {...quote,projectId:input.projectId,request:input.request,model:plan.model,
      requests:plan.requests,deliverables:plan.deliverables,estimatedCost:plan.estimatedCost,
      currency:plan.currency,costStatus:plan.costStatus,policy:plan.policy};
  }

  async geoQuote(grantId:string,ctx:RequestContext,input:z.infer<typeof geoQuoteInput>){
    const estimate=await this.geo.estimate(ctx,input.projectId,input.selection);
    const quote=await this.saveQuote('geo',grantId,ctx,input,estimate.estimateHash,new Date(Date.now()+300000));
    return {...quote,projectId:input.projectId,estimatedCostMicros:estimate.estimatedCostMicros,
      currency:'CNY',maxCostMicros:input.selection.maxCostMicros,eligibleRuns:estimate.eligibleRuns,
      skippedRuns:estimate.skippedRuns,baselineId:input.selection.baselineId??null,
      questions:estimate.snapshot.questions.map(({id,text,nativeWebSearch})=>({id,text,nativeWebSearch})),
      models:estimate.snapshot.models.map(({id,name,versionId})=>({id,name,versionId}))};
  }

  private async ownedQuote(app:ExecutionConnectorApp,grantId:string,ctx:RequestContext,id:string){
    const row=await this.db.connectorAction.findFirst({where:{
      id,grantId,tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,
      appId:app,command:commands[app],
    }});
    if(!row)throw new NotFoundException('预览不存在或不可见');
    return row;
  }

  async submit(app:ExecutionConnectorApp,grantId:string,ctx:RequestContext,id:string){
    const quote=await this.ownedQuote(app,grantId,ctx,id);
    if(quote.expiresAt<=new Date()){
      const existing=await this.status(app,grantId,ctx,id);
      if(existing.status==='expired')throw new ConflictException('预览已过期，请重新核对参数与费用');
      return existing;
    }
    const {nativeHash}=quote.preview as {nativeHash:string};
    if(app==='content'){
      const {projectId,request}=contentQuoteInput.parse(quote.input);
      await this.content.submit(ctx,projectId,{
        request,previewHash:nativeHash,expiresAt:quote.expiresAt.toISOString(),requestKey:quote.requestKey,
      });
    }else{
      const {projectId,selection}=geoQuoteInput.parse(quote.input);
      await this.geo.submit(ctx,projectId,{...selection,estimateHash:nativeHash,requestKey:quote.requestKey});
    }
    return this.status(app,grantId,ctx,id);
  }

  async status(app:ExecutionConnectorApp,grantId:string,ctx:RequestContext,id:string){
    const quote=await this.ownedQuote(app,grantId,ctx,id);
    const {projectId}=quote.input as {projectId:string};
    const base=publicOrigin()+'/t/'+encodeURIComponent(ctx.tenantKey)+'/'+app+'/projects/'+projectId;
    if(app==='content'){
      const batch=await this.content.generationForRequest(ctx,projectId,quote.requestKey);
      if(batch)return {quoteId:id,status:'submitted',projectId,batchId:batch.id,items:batch.items,destination:base};
    }else{
      const analysisId=await this.geo.analysisIdForRequest(ctx,projectId,quote.requestKey);
      if(analysisId){
        const row=await this.geo.analysis(ctx,analysisId);
        return {quoteId:id,status:row.status,projectId,analysisId,
          estimatedCostMicros:row.estimatedCostMicros,actualCostMicros:row.actualCostMicros,
          destination:base+'/analyses/'+analysisId};
      }
    }
    return {quoteId:id,status:quote.expiresAt<=new Date()?'expired':'not_submitted',projectId};
  }
}
