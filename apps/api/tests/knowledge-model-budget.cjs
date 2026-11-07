const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {PrismaService}=require('../dist/modules/prisma.service'),{KnowledgeModelBudget,textTokenReservation}=require('../dist/modules/knowledge/knowledge-model-budget');
(async()=>{
 assert.match(process.env.DATABASE_URL??'',/@127\.0\.0\.1:54339\/suite_native_qa$/);const db=new PrismaService(),prefix='knowledge-budget-test:'+randomUUID();let checks=0,calls=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;},scope=(suffix,maxCalls=3,maxTokens=30)=>({tenantId:prefix,requestId:prefix+':'+suffix,maxCalls,maxTokens});
 const response=(input=4,output=0)=>({model:'synthetic-only',usage:{prompt_tokens:input,completion_tokens:output,total_tokens:input+output}});
 try{
  const shared=new KnowledgeModelBudget(db,scope('parallel'));
  const race=await Promise.allSettled(Array.from({length:10},()=>shared.run('embedding','synthetic-only',10,0,async()=>{calls++;return response();})));
  eq(calls,3);eq(race.filter(r=>r.status==='fulfilled').length,3);eq(await db.aiModelUsage.count({where:{requestId:shared.scope.requestId}}),3);
  await assert.rejects(()=>shared.run('embedding','synthetic-only',1,0,async()=>{calls++;return response();}),e=>e.code==='KNOWLEDGE_MODEL_BUDGET_EXCEEDED');checks++;eq(calls,3);
  await assert.rejects(()=>new KnowledgeModelBudget(db,shared.scope).assertFresh(),e=>e.code==='KNOWLEDGE_RETRY_REQUIRES_REVIEW');checks++;
  const unknown=new KnowledgeModelBudget(db,scope('unknown'));
  await assert.rejects(()=>unknown.run('ocr','synthetic-only',10,2,async()=>{calls++;return {choices:[]};}),e=>e.code==='KNOWLEDGE_USAGE_UNKNOWN');checks++;
  const before=calls;await assert.rejects(()=>unknown.run('ocr','synthetic-only',10,2,async()=>{calls++;return response();}),e=>e.code==='KNOWLEDGE_USAGE_UNKNOWN');checks++;eq(calls,before);
  const zero=new KnowledgeModelBudget(db,scope('all-zero'));await assert.rejects(()=>zero.run('embedding','synthetic-only',10,0,async()=>response(0,0)),e=>e.code==='KNOWLEDGE_USAGE_UNKNOWN');checks++;
  const lost=new KnowledgeModelBudget(db,scope('network'));
  await assert.rejects(()=>lost.run('embedding','synthetic-only',10,0,async()=>{throw new Error('Synthetic timeout after dispatch');}));checks++;
  await assert.rejects(()=>new KnowledgeModelBudget(db,lost.scope).assertFresh(),e=>e.code==='KNOWLEDGE_RETRY_REQUIRES_REVIEW');checks++;
  eq((await db.aiModelUsage.findFirst({where:{requestId:lost.scope.requestId}})).usageStatus,'unknown');
  const over=new KnowledgeModelBudget(db,scope('over'));
  await assert.rejects(()=>over.run('ocr','synthetic-only',5,2,async()=>response(8,3)),e=>e.code==='KNOWLEDGE_MODEL_BUDGET_EXCEEDED');checks++;
  eq((await db.aiModelUsage.findFirst({where:{requestId:over.scope.requestId}})).totalTokens,11);
  await assert.rejects(()=>over.run('ocr','synthetic-only',1,1,async()=>response()),e=>e.code==='KNOWLEDGE_USAGE_UNKNOWN');checks++;
  const out=new KnowledgeModelBudget(db,scope('output'));
  await assert.rejects(()=>out.run('ocr','synthetic-only',20,1,async()=>response(1,3)),e=>e.code==='KNOWLEDGE_MODEL_BUDGET_EXCEEDED');checks++;
  const preflight=new KnowledgeModelBudget(db,scope('bulk',2,100));await assert.rejects(()=>preflight.preflight(3,20),e=>e.code==='KNOWLEDGE_MODEL_BUDGET_EXCEEDED');checks++;eq(await db.aiModelUsage.count({where:{requestId:preflight.scope.requestId}}),0);
  await preflight.preflight(2,100);eq(textTokenReservation(['采购'])>=Buffer.byteLength('采购'),true);
  const crashed=new KnowledgeModelBudget(db,scope('crash'));
  await db.aiModelUsage.create({data:{id:randomUUID(),tenantId:prefix,appId:'platform',requestId:crashed.scope.requestId,source:'knowledge:ocr',purpose:'knowledge_ocr',reservedTokens:10}});
  await assert.rejects(()=>new KnowledgeModelBudget(db,crashed.scope).assertFresh(),e=>e.code==='KNOWLEDGE_RETRY_REQUIRES_REVIEW');checks++;
  const fresh=new KnowledgeModelBudget(db,scope('new-explicit-attempt'));await fresh.assertFresh();await fresh.run('embedding','synthetic-only',10,0,async()=>response());eq(await db.aiModelUsage.count({where:{requestId:fresh.scope.requestId,status:'completed'}}),1);
  const nonbillable=new KnowledgeModelBudget(db,scope('local-only'));await nonbillable.assertFresh();eq(nonbillable.attempted,false);eq(await db.aiModelUsage.count({where:{requestId:nonbillable.scope.requestId}}),0);
  const report={at:new Date().toISOString(),assertions:checks,parallelRequests:10,acceptedDispatches:3,coverage:['durable reservation','token/output caps','unknown/timeout stop','crash replay blocked','explicit new attempt','bulk preflight before dispatch','no source/credentials in ledger'],provider:'synthetic only'};const dest=path.join(process.env.NATIVE_QA_OUTPUT_DIR,'budget-verification.json');fs.writeFileSync(dest,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await db.aiModelUsage.deleteMany({where:{tenantId:prefix}});await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
