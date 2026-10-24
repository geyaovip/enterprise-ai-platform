const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AgentExecutionService}=require('../dist/modules/ai/agent.runtime'),{CrmAiProvider}=require('../dist/modules/crm/crm-ai.provider'),{infrastructureSecret}=require('../dist/modules/platform/infrastructure-contract'),{createCrmFixture,cleanupFixture}=require('../scripts/crm-fixture.cjs');
(async()=>{
 assert.equal(process.env.PAID_MODEL_TEST,'1');assert.match(process.env.DATABASE_URL||'',/127\.0\.0\.1:54329\/suite_phase1_qa/);delete process.env.RUNTIME_MANAGER_SOCKET;delete process.env.AGENT_RUNTIME_PROVIDER;delete process.env.MEMORY_CORE_URL;
 const out=process.env.CRM_TEST_OUTPUT_DIR;assert.ok(out);const prior=JSON.parse(fs.readFileSync(path.join(out,'real-model-results.json'))),preview=prior.reports.flatMap(r=>r.tools||[]).find(t=>t.tool==='crm.preview_segment').result;
 assert.equal(preview.usableForTask,true);const facts={asOf:preview.asOf,expiresAt:preview.expiresAt,usableForTask:preview.usableForTask,invalidReason:preview.invalidReason};
 const db=new PrismaService(),batchId=randomUUID();process.env.AI_USAGE_BATCH_ID=batchId;let app,f;
 try{app=await createApp();f=await createCrmFixture(db,app);const b=JSON.parse(fs.readFileSync(path.join(out,'gateway/binding.private.json')));assert.equal(b.model,'doubao-seed-evolving');const ctx=f.contexts.admin;
  await db.infrastructureBinding.create({data:{tenantId:f.tenant.id,kind:'runtime',provider:'openclaw',scopeKey:ctx.membershipId,baseUrl:b.baseUrl,secretCiphertext:infrastructureSecret(b.secret),options:b.options}});
  const c=await db.aiConversation.create({data:{tenantId:f.tenant.id,userId:ctx.userId,appId:'crm',title:'隔离QA：预览计算时点'}});
  const result=await app.get(AgentExecutionService).execute({request:ctx,sessionId:c.id},[{role:'system',content:app.get(CrmAiProvider).instructions+' 当前为固定业务时钟的隔离QA。只根据本轮工具状态回答，输出JSON：{"state":"usable|expired|unknown","reason":"简短理由"}，不要重新查询或提出操作。'},{role:'user',content:'请核对这个预览在工具计算时点是否可用；有人按网关日期称它已过期，是否有依据？工具结果：'+JSON.stringify(facts)}],[],undefined,'deep');
  const answer=JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g,''));assert.equal(answer.state,'usable');
  fs.writeFileSync(path.join(out,'clock-model-result.json'),JSON.stringify({at:new Date().toISOString(),batchId,model:b.model,ok:true,answer,usage:result.usage},null,2));
  console.log(JSON.stringify({ok:true,case:'AI-CLOCK-01',model:b.model,usage:result.usage}));
 }finally{if(app)await app.close();if(f){const rows=await db.aiModelUsage.findMany({where:{tenantId:f.tenant.id}});fs.writeFileSync(path.join(out,'ledger-'+batchId+'.json'),JSON.stringify({batchId,model:'doubao-seed-evolving',records:rows},null,2),{mode:0o600});await db.usageRecord.deleteMany({where:{tenantId:f.tenant.id}});await cleanupFixture(db,f);}await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
