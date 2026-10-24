const assert=require('node:assert/strict'),http=require('node:http'),{randomUUID}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{AiService}=require('../dist/modules/ai/ai.service'),{processNextTask}=require('../dist/worker'),{infrastructureSecret}=require('../dist/modules/platform/infrastructure-contract'),{createFixture,fixtureHttp,cleanupFixture}=require('../scripts/workflow-fixture.cjs');
(async()=>{
 if(!/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(process.env.DATABASE_URL??''))throw Error('Isolated QA DB required');
 process.env.NODE_ENV='test';delete process.env.RUNTIME_MANAGER_SOCKET;delete process.env.AGENT_RUNTIME_PROVIDER;delete process.env.MEMORY_CORE_URL;
 const db=new PrismaService();let f,app,model,lastInput;let checks=0;
 const eq=(a,b)=>{assert.deepEqual(a,b);checks++;},ok=(v)=>{assert.ok(v);checks++;};
 try{
  f=await createFixture(db,'erp-flow-test-'+randomUUID().slice(0,8));await db.tenantCapability.create({data:{tenantId:f.tenant.id,capability:'ai',delivered:true,enabled:true}});
  model=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=lastInput=JSON.parse(raw),query=body.input.at(-1).content[0].text;
   const output=body.tools?.some(tool=>tool.name==='erp__customer__create')?[{type:'function_call',name:'erp__customer__create',call_id:randomUUID(),arguments:JSON.stringify({code:'UX-'+query.match(/CODE_(\w+)/)[1],name:'交互隔离测试客户'})}]:[{type:'message',content:[{type:'output_text',text:'只读快速回答。'}]}];
   const final={id:randomUUID(),status:'completed',output};
   if(body.stream){res.setHeader('content-type','text/event-stream');res.end('event: response.completed\ndata: '+JSON.stringify({response:final})+'\n\ndata: [DONE]\n\n');}
   else{res.setHeader('content-type','application/json');res.end(JSON.stringify(final));}
  });await new Promise(r=>model.listen(0,'127.0.0.1',r));
  await db.infrastructureBinding.create({data:{tenantId:f.tenant.id,kind:'runtime',scopeKey:f.accounts.admin.memberId,provider:'openclaw',baseUrl:'http://127.0.0.1:'+model.address().port,secretCiphertext:infrastructureSecret('qa-composer-runtime-private'),options:{agentId:'qa-composer',fastAgentId:'qa-composer-fast',readAgentId:'qa-composer-read',ephemeralTurns:true}}});
  app=await createApp();const h=await fixtureHttp(app,f),base='/tenants/'+f.tenant.slug+'/ai';
  const conversation=async()=> (await h.request(base+'/conversations','POST',{title:'默认交互验证'})).data;
  const count=()=>db.erpCustomer.count({where:{tenantId:f.tenant.id}});
  const before=await count(),c=await conversation();
  const body={content:'创建客户 CODE_PENDING',version:c.version,allowAction:true,requireConfirmation:true,useKnowledge:false,requestKey:randomUUID()};
  const job=(await h.request(base+'/conversations/'+c.id+'/turns','POST',body)).data;
  eq((await h.request(base+'/conversations/'+c.id+'/turns','POST',body)).data.id,job.id);
  await h.request(base+'/conversations/'+c.id+'/turns','POST',{...body,requireConfirmation:false},'admin',409);checks++;
  await processNextTask(db,app.get(AuthService),app.get(AiService));
  const completed=(await h.request(base+'/tasks/'+job.id)).data;assert.equal(completed.status,'completed',JSON.stringify(completed));checks++;
  const chat=(await h.request(base+'/conversations/'+c.id)).data,actionId=chat.messages.at(-1).actionId;ok(actionId);
  const action=(await h.request(base+'/actions/'+actionId)).data;eq(action.status,'pending');eq(action.confirmationRequired,true);eq(await count(),before);
  ok(chat.messages.at(-1).process.tools.some(tool=>tool.actionId===actionId&&tool.status==='pending'));
  eq((await h.request(base+'/actions/'+actionId+'/confirm','POST',{})).data.status,'completed');eq(await count(),before+1);
  eq((await h.request(base+'/actions/'+actionId+'/confirm','POST',{})).data.status,'completed');eq(await count(),before+1);
  const cancel=await conversation(),reply=(await h.request(base+'/conversations/'+cancel.id+'/messages','POST',{...body,version:cancel.version,content:'创建客户 CODE_CANCEL',requestKey:undefined})).data;
  await h.request(base+'/actions/'+reply.message.actionId+'/cancel','POST',{});eq(await count(),before+1);
  const fast=await conversation();await h.request(base+'/conversations/'+fast.id+'/messages','POST',{content:'你好',version:fast.version,allowAction:true,requireConfirmation:true,useKnowledge:false,thinkingMode:'fast'});eq(lastInput.tools,[]);eq(await count(),before+1);
  const denied=await conversation();await h.request(base+'/conversations/'+denied.id+'/messages','POST',{content:'创建客户 CODE_NO_ALLOW',version:denied.version,allowAction:false,requireConfirmation:true});eq(lastInput.tools,[]);eq(await count(),before+1);
  // Older clients keep their explicit one-turn consent contract.
  const legacy=await conversation();await h.request(base+'/conversations/'+legacy.id+'/messages','POST',{content:'创建客户 CODE_LEGACY',version:legacy.version,allowAction:true});eq(await count(),before+2);
  const management='/tenants/'+f.tenant.slug+'/management-ai',m=(await h.request(management+'/conversations','POST',{title:'只读管理边界'})).data;
  await h.request(management+'/conversations/'+m.id+'/messages','POST',{...body,version:m.version},'admin',409);checks++;
  console.log(JSON.stringify({at:new Date().toISOString(),assertions:checks,httpChecks:h.checks(),model:'HTTP fixture',confirmed:['pending before write','single confirm and replay idempotency','cancel without write','fast mode without tools','no consent escalation','legacy compatibility','management read-only']}));
 }finally{if(app)await app.close();if(model)await new Promise(r=>model.close(r));if(f)await cleanupFixture(db,f);await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
