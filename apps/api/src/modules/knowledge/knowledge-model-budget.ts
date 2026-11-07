import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { NativeKnowledgeError } from './native-parser';
import { usageColumns, type RuntimeReceipt } from '../ai/runtime-usage';

type Kind='embedding'|'ocr'|'rerank';
type Scope={tenantId:string;membershipId?:string;requestId:string;maxCalls:number;maxTokens:number};
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export const textTokenReservation=(texts:string[])=>texts.reduce((n,t)=>n+Buffer.byteLength(t,'utf8')+256,256);

/** Persist before dispatch. Uncertain paid work is never replayed by a worker retry. */
export class KnowledgeModelBudget{
  attempted=false;
  stopped=false;
  constructor(private readonly db:PrismaService,readonly scope:Scope){}
  async assertFresh(){
    if(await this.db.aiModelUsage.count({where:{requestId:this.scope.requestId,source:{startsWith:'knowledge:'}}}))throw new NativeKnowledgeError('KNOWLEDGE_RETRY_REQUIRES_REVIEW');
  }
  async preflight(calls:number,tokens:number){
    const rows=await this.db.aiModelUsage.findMany({where:{requestId:this.scope.requestId,source:{startsWith:'knowledge:'}},select:{reservedTokens:true,totalTokens:true,inputTokens:true,outputTokens:true}});
    const used=rows.reduce((n,r)=>n+Math.max(r.reservedTokens??0,r.totalTokens??0,(r.inputTokens??0)+(r.outputTokens??0)),0);
    if(this.stopped||rows.length+calls>this.scope.maxCalls||used+tokens>this.scope.maxTokens)throw new NativeKnowledgeError('KNOWLEDGE_MODEL_BUDGET_EXCEEDED');
  }
  async run<T>(kind:Kind,model:string,reservedInput:number,maxOutput:number,dispatch:()=>Promise<T>):Promise<T>{
    if(!valid(reservedInput)||!valid(maxOutput)||reservedInput+maxOutput<1)throw new NativeKnowledgeError('KNOWLEDGE_MODEL_BUDGET_EXCEEDED');
    const id=randomUUID(),reservedTokens=reservedInput+maxOutput;
    await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'knowledge-budget:'+this.scope.requestId},0))`;
      const rows=await tx.aiModelUsage.findMany({where:{requestId:this.scope.requestId,source:{startsWith:'knowledge:'}},select:{reservedTokens:true,totalTokens:true,inputTokens:true,outputTokens:true,status:true,usageStatus:true}});
      const used=rows.reduce((n,r)=>n+Math.max(r.reservedTokens??0,r.totalTokens??0,(r.inputTokens??0)+(r.outputTokens??0)),0);
      if(this.stopped||rows.some(r=>r.status!=='started'&&r.usageStatus!=='reported'))throw new NativeKnowledgeError('KNOWLEDGE_USAGE_UNKNOWN');
      if(rows.length>=this.scope.maxCalls||used+reservedTokens>this.scope.maxTokens)throw new NativeKnowledgeError('KNOWLEDGE_MODEL_BUDGET_EXCEEDED');
      await tx.aiModelUsage.create({data:{id,tenantId:this.scope.tenantId,membershipId:this.scope.membershipId,appId:'platform',requestId:this.scope.requestId,source:'knowledge:'+kind,purpose:'knowledge_'+kind,environment:process.env.NODE_ENV??'unknown',requestedModel:model,reservedTokens}});
    });
    this.attempted=true;
    let reported=false;
    try{
      const result=await dispatch(),raw=result as any,u=raw?.usage;
      let input=u?.prompt_tokens??u?.input_tokens,output=u?.completion_tokens??u?.output_tokens;
      if(kind!=='ocr'&&valid(u?.total_tokens)){if(!valid(input))input=u.total_tokens;if(!valid(output))output=0;}
      const receipt:RuntimeReceipt={requestedModel:model,model:typeof raw.model==='string'?raw.model:undefined,externalId:typeof raw.id==='string'?raw.id:undefined,usage:{inputTokens:valid(input)?input:undefined,outputTokens:valid(output)?output:undefined,totalTokens:valid(input)&&valid(output)?Math.max(valid(u?.total_tokens)?u.total_tokens:0,input+output):valid(u?.total_tokens)?u.total_tokens:undefined,cachedInputTokens:u?.prompt_tokens_details?.cached_tokens,reasoningTokens:u?.completion_tokens_details?.reasoning_tokens}};
      const columns=usageColumns(receipt);
      reported=columns.usageStatus==='reported'&&input+output>0;
      await this.db.aiModelUsage.update({where:{id},data:{...columns,status:reported?'completed':'failed',finishedAt:new Date(),errorCode:reported?null:'KNOWLEDGE_USAGE_UNKNOWN'}});
      if(!reported){this.stopped=true;throw new NativeKnowledgeError('KNOWLEDGE_USAGE_UNKNOWN');}
      if(Math.max(columns.totalTokens??0,input+output)>reservedTokens||output>maxOutput){this.stopped=true;throw new NativeKnowledgeError('KNOWLEDGE_MODEL_BUDGET_EXCEEDED');}
      return result;
    }catch(error){
      this.stopped=true;
      if(!reported)await this.db.aiModelUsage.update({where:{id},data:{status:'failed',usageStatus:'unknown',finishedAt:new Date(),errorCode:error instanceof Error?error.name:'UNKNOWN'}});
      throw error;
    }
  }
}
