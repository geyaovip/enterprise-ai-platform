// Real API + disposable PostgreSQL + a loopback model fixture. No paid requests.
const assert=require('node:assert/strict'),http=require('node:http'),{randomUUID}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{MesService}=require('../dist/modules/mes/mes.service'),{CrmImportService}=require('../dist/modules/crm/import.service'),{infrastructureSecret}=require('../dist/modules/platform/infrastructure-contract'),{SourceExtractionService,validateSourceImage}=require('../dist/modules/ai/source-extraction.service'),{assertInputBudget}=require('../dist/modules/ai/input-budget');
const {createCrmFixture,cleanupFixture}=require('../scripts/crm-fixture.cjs'),{fixtureHttp}=require('../scripts/workflow-fixture.cjs');
const {suggestImportMapping}=require('../dist/modules/crm/import-mapping');
(async()=>{
  assert.match(process.env.DATABASE_URL??'',/@127\.0\.0\.1:54329\/suite_phase1_qa/);
  const db=new PrismaService();let app,f,server,mode='erp',wire=[],after,delayNext,entered;
  let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;},ok=x=>{assert.ok(x);checks++;};
  const source={text:'请向供货甲购买物料甲，每件用量2件。'},png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a32kAAAAASUVORK5CYII=';
  try{
    server=http.createServer(async(req,res)=>{
      let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);wire.push(body);if(delayNext){const gate=delayNext;delayNext=null;entered();await gate;}
      let answer=mode==='mes'?{product:{sku:'FG-01',name:'装配件',evidence:'产品 FG-01'},lines:[{sku:'RAW-01',name:'物料甲',quantity:'2',unit:'件',wastePercent:'0',parent:'',evidence:'第1行：RAW-01 2件'}],uncertainties:[]}:
        ['segment','window'].includes(mode)?{name:'待召回客户',rule:{match:'all',conditions:[{field:'lifetimeNetAmount',op:'gte',value:'1000.00'},{field:'recencyDays',op:'gt',value:30}]},uncertainties:[]}:
        mode==='unclear'?{name:'待明确客户',rule:null,uncertainties:['高价值阈值尚未提供']}:
        mode==='mapping'?{fields:{display_name:'顾客昵称'},uncertainties:[]}:
        {party:{code:'SUP-01',name:'供货甲',evidence:'供应商 SUP-01'},lines:[{sku:'RAW-01',name:'物料甲',quantity:'2',unit:'件',evidence:'RAW-01 2件'}],note:'',uncertainties:[]};
      if(mode==='window')answer.windowDays=30;
      if(mode==='price'){answer.lines[0].unitPrice='12.50';answer.lines[0].currency='CNY';}
      if(mode==='foreign'){answer.lines[0].unitPrice='12.50';answer.lines[0].currency='USD';}
      if(mode==='missing')answer.lines[0].quantity=null;
      if(mode==='ambiguous'){answer.lines[0].sku='';answer.lines[0].name='同名商品';}
      if(mode==='bad-code')answer.lines[0].sku='NOT-EXISTS';
      if(mode==='unit')answer.lines[0].unit='箱';
      if(mode==='nested'){answer={product:{sku:'FG-01',name:'装配件'},lines:[{sku:'RAW-01',name:'物料甲',quantity:'2',unit:'件',wastePercent:null,parent:'另一装配'}],uncertainties:['有多层装配']};}
      if(mode==='bad-mapping')answer={fields:{paid_amount:'顾客昵称'},uncertainties:[]};
      if(mode==='unknown-header')answer={fields:{display_name:'不存在的列'},uncertainties:[]};
      if(after){const fn=after;after=null;await fn();}
      const output=mode==='tool'?[{type:'function_call',name:'erp__purchase__confirm',call_id:randomUUID(),arguments:'{}'}]:[{type:'message',content:[{type:'output_text',text:mode==='invalid'?'broken JSON':JSON.stringify(answer)}]}];
      res.setHeader('content-type','application/json');res.end(JSON.stringify({id:randomUUID(),status:'completed',model:'local-business-intake-fixture',usage:{input_tokens:100,output_tokens:20,total_tokens:120},output}));
    });await new Promise(r=>server.listen(0,'127.0.0.1',r));
    app=await createApp();f=await createCrmFixture(db,app);await db.tenantApp.createMany({data:['erp','mes'].map(appId=>({tenantId:f.tenant.id,appId}))});
    const h=await fixtureHttp(app,f),auth=app.get(AuthService),mes=app.get(MesService),imports=app.get(CrmImportService);
    const mc=await auth.taskContext({tenantId:f.tenant.id,userId:f.accounts.admin.userId,membershipId:f.accounts.admin.memberId,appId:'mes',taskId:randomUUID()});
    const supplier=await h.post('/suppliers',{code:'SUP-01',name:'供货甲'}),product=await h.post('/products',{sku:'RAW-01',name:'物料甲',unit:'件',salePrice:'10.00',purchasePrice:'5.00'});
    await h.post('/products',{sku:'SAME-01',name:'同名商品',salePrice:'10',purchasePrice:'5'});await h.post('/products',{sku:'SAME-02',name:'同名商品',salePrice:'10',purchasePrice:'5'});
    const fg=await mes.saveMaterial(mc,undefined,{requestKey:randomUUID(),sku:'FG-01',name:'装配件',kind:'finished',unit:'件'}),raw=await mes.saveMaterial(mc,undefined,{requestKey:randomUUID(),sku:'RAW-01',name:'物料甲',kind:'raw',unit:'件'});
    const binding=await db.infrastructureBinding.create({data:{tenantId:f.tenant.id,kind:'runtime',scopeKey:mc.membershipId,provider:'openclaw',baseUrl:'http://127.0.0.1:'+server.address().port,secretCiphertext:infrastructureSecret('local-business-intake-only'),options:{agentId:'erp-assistant',readAgentId:'erp-assistant-read',ephemeralTurns:true,imageInputApps:['mes']}}});
    const endpoint=appId=>`/tenants/${f.tenant.slug}/apps/${appId}/ai/intake`;
    const call=async(appId,input,status=201,key='admin')=>(await h.request(endpoint(appId),'POST',input,key,status)).data;
    const counts=async()=>[await db.erpPurchaseOrder.count({where:{tenantId:f.tenant.id}}),await db.erpSalesContract.count({where:{tenantId:f.tenant.id}}),await db.mesBom.count({where:{tenantId:f.tenant.id}}),await db.crmSegment.count({where:{tenantId:f.tenant.id}})];
    const baseline=await counts();
    let before=wire.length;await call('erp',{kind:'purchase',source:{text:'  '}},400);eq(wire.length,before);
    const r=await call('erp',{kind:'purchase',source});eq(r.party.id,supplier.id);eq(r.lines[0].product.id,product.id);eq(r.lines[0].quantity,2);eq(wire.length,before+1);ok(!JSON.stringify(wire.at(-1)).includes(product.id));eq(wire.at(-1).tools,[]);
    // Adoption uses the existing domain write, and does not submit/approve it.
    const saved=await h.post('/purchases',{number:'INTAKE-PO',supplierId:r.party.id,lines:r.lines.map(l=>({productId:l.product.id,quantity:l.quantity}))});eq(saved.status,'draft');
    mode='price';eq((await call('erp',{kind:'purchase',source})).lines[0].unitPrice,'12.50');
    mode='foreign';eq((await call('erp',{kind:'purchase',source})).lines[0].unitPrice,null);
    mode='missing';eq((await call('erp',{kind:'purchase',source})).lines[0].quantity,null);
    mode='unit';const u=await call('erp',{kind:'purchase',source});eq([u.lines[0].quantity,u.lines[0].unitConflict],[null,true]);
    mode='ambiguous';const a=await call('erp',{kind:'purchase',source});eq([a.lines[0].product,a.lines[0].status],[null,'ambiguous']);
    mode='bad-code';eq((await call('erp',{kind:'purchase',source})).lines[0].product,null);
    mode='erp';before=wire.length;await call('erp',{kind:'purchase',source},403,'finance');eq(wire.length,before);
    await db.tenantCapability.update({where:{tenantId_capability:{tenantId:f.tenant.id,capability:'ai'}},data:{enabled:false}});await call('erp',{kind:'purchase',source},403);eq(wire.length,before);await db.tenantCapability.update({where:{tenantId_capability:{tenantId:f.tenant.id,capability:'ai'}},data:{enabled:true}});
    // Concurrent duplicate clicks must not create two physical model requests.
    mode='erp';before=wire.length;let release;const arrived=new Promise(r=>entered=r);delayNext=new Promise(r=>release=r);const pending=call('erp',{kind:'purchase',source});await arrived;await call('erp',{kind:'purchase',source},409);eq(wire.length,before+1);release();await pending;
    // Short, meaningful requirements no longer require artificial padding.
    await call('erp',{kind:'purchase',source:{text:'RAW-01 2件'}});
    // A changed role rejects delivery but retains the observed provider usage.
    after=()=>db.membership.update({where:{id:mc.membershipId},data:{role:'warehouse'}});await call('erp',{kind:'purchase',source},409);await db.membership.update({where:{id:mc.membershipId},data:{role:'admin'}});
    mode='invalid';before=wire.length;await call('erp',{kind:'purchase',source},503);eq(wire.length,before+1);
    mode='tool';await call('erp',{kind:'purchase',source},503);eq(await db.aiAction.count({where:{tenantId:f.tenant.id}}),0);
    mode='mes';const b=await call('mes',{kind:'bom',source});eq(b.product.id,fg.id);eq(b.lines[0].material.id,raw.id);eq(b.lines[0].quantity,'2');eq(b.lines[0].wastePercent,'0');
    const bom=await mes.saveBom(mc,undefined,{requestKey:randomUUID(),draft:{productId:b.product.id,lines:b.lines.map(l=>({materialId:l.material.id,quantity:l.quantity,wastePercent:l.wastePercent}))}});eq(bom.status,'draft');
    mode='nested';const nested=await call('mes',{kind:'bom',source});eq([nested.lines[0].nested,nested.lines[0].quantity,nested.lines[0].wastePercent],[true,null,null]);
    // Images are independently gated, validated, and routed only to the capable app.
    mode='mes';delete process.env.AI_IMAGE_INTAKE_ENABLED;before=wire.length;await call('mes',{kind:'bom',source:{image:{mime:'image/png',data:png}}},503);eq(wire.length,before);
    process.env.AI_IMAGE_INTAKE_ENABLED='true';await call('mes',{kind:'bom',source:{image:{mime:'image/png',data:Buffer.from('not a png').toString('base64')}}},400);eq(wire.length,before);
    await call('mes',{kind:'bom',source:{image:{mime:'image/png',data:png}}});eq(wire.length,before+1);eq(wire.at(-1).model,'openclaw/mes-assistant');eq(wire.at(-1).input[0].content[1].source.data,png);ok(!wire.at(-1).instructions.includes(png));
    mode='erp';before=wire.length;await call('erp',{kind:'purchase',source:{image:{mime:'image/png',data:png}}},409);eq(wire.length,before);
    const oversized=Buffer.from(png,'base64');oversized.writeUInt32BE(5000,16);assert.throws(()=>validateSourceImage({mime:'image/png',data:oversized.toString('base64')}));checks++;
    assert.doesNotThrow(()=>assertInputBudget([{role:'user',content:'明细',images:[{mime:'image/png',data:'a'.repeat(2700000)}]}]));checks++;
    assert.throws(()=>assertInputBudget([{role:'user',content:'字'.repeat(20000),images:[{mime:'image/png',data:png}]}]),/输入超过/);checks++;
    delete process.env.AI_IMAGE_INTAKE_ENABLED;
    if(process.env.BUSINESS_INTAKE_OCR_FIXTURE){
      mode='mes';before=wire.length;const picture=require('node:fs').readFileSync(process.env.BUSINESS_INTAKE_OCR_FIXTURE).toString('base64');
      const fromImage=await call('mes',{kind:'bom',source:{image:{mime:'image/png',data:picture}}});eq(fromImage.lines[0].material.id,raw.id);eq(wire.length,before+1);ok(wire.at(-1).input[0].content[0].text.includes('RAW-01'));eq(wire.at(-1).input[0].content.length,1);
    }
    mode='segment';const segment=await call('crm',{kind:'segment',source:{text:'找出30天未购买且历史净消费超过1000元的客户'}});eq(segment.preview.memberCount,1);ok(segment.preview.evaluationId);eq(await db.crmSegment.count({where:{tenantId:f.tenant.id}}),0);eq(Date.parse(segment.rule.windowEnd),Date.parse(f.clock));
    await db.crmSettings.update({where:{tenantId:f.tenant.id},data:{currency:'USD'}});mode='window';const customWindow=await call('crm',{kind:'segment',source:{text:'最近30天净消费不少于1000美元的客户'}});eq(customWindow.rule.currency,'USD');eq(Date.parse(customWindow.rule.windowStart),Date.parse(f.clock)-30*86400000);await db.crmSettings.update({where:{tenantId:f.tenant.id},data:{currency:'CNY'}});
    mode='unclear';const unclear=await call('crm',{kind:'segment',source:{text:'找出那些高价值但不活跃的客户'}});eq([unclear.rule,unclear.preview],[null,null]);
    // Common header matching uses zero model calls and preserves source IDs as text.
    before=wire.length;let batch=await imports.create(f.contexts.admin,{channelId:f.channel.id,kind:'customer',requestKey:randomUUID()});
    const csv='客户编号,顾客昵称,来源创建时间,来源更新时间\n000050,PRIVATE_CONTACT_SENTINEL,2026-10-01T00:00:00+08:00,2026-10-10T00:00:00+08:00';
    batch=await imports.upload(f.contexts.admin,batch.id,'customer',{version:batch.version,requestKey:randomUUID(),filename:'顾客.csv',format:'csv',contentBase64:Buffer.from(csv).toString('base64')});
    eq(batch.mapping.fields.customer.external_customer_id,'客户编号');eq(wire.length,before);
    mode='mapping';const mapping=await call('crm',{kind:'import_mapping',batchId:batch.id,version:batch.version,role:'customer'});eq(mapping.fields.display_name,'顾客昵称');ok(!JSON.stringify(wire.at(-1)).includes('PRIVATE_CONTACT_SENTINEL'));
    mode='bad-mapping';await call('crm',{kind:'import_mapping',batchId:batch.id,version:batch.version,role:'customer'},400);
    mode='unknown-header';await call('crm',{kind:'import_mapping',batchId:batch.id,version:batch.version,role:'customer'},400);
    mode='mapping';after=()=>db.crmImportBatch.update({where:{id:batch.id},data:{version:{increment:1}}});await call('crm',{kind:'import_mapping',batchId:batch.id,version:batch.version,role:'customer'},409);
    const aliases=suggestImportMapping('order',['订单号','订单总金额','实付金额','退款金额']);eq(aliases.fields,{external_order_id:'订单号',paid_amount:'实付金额',refund_amount:'退款金额'});
    const ambiguous=suggestImportMapping('customer',['客户编号','会员编号']);ok(ambiguous.conflicts.includes('external_customer_id'));eq(ambiguous.fields.external_customer_id,undefined);
    eq(suggestImportMapping('customer',['客户编号','会员编号'],{external_customer_id:'会员编号'}).fields.external_customer_id,'会员编号');
    // CRM production release gate cannot be bypassed by the new endpoint.
    process.env.CRM_AI_RELEASE_ENABLED='false';before=wire.length;await call('crm',{kind:'segment',source:{text:'最近30天未购买的客户'}},403);eq(wire.length,before);process.env.CRM_AI_RELEASE_ENABLED='true';
    const end=await counts();eq(end,[baseline[0]+1,baseline[1],baseline[2]+1,baseline[3]]);
    const usage=await db.aiModelUsage.findMany({where:{tenantId:f.tenant.id,inputTokens:100}});eq(usage.length,wire.length);ok(usage.every(x=>x.purpose==='document_extract'));ok(usage.every(x=>x.inputTokens===100&&x.outputTokens===20));
    console.log(JSON.stringify({ok:true,checks,physicalFixtureRequests:wire.length,paidRequests:0,scope:['ERP intake and draft save','MES intake and BOM draft save','CRM rule preview and header assistance','ambiguity and missing quantities','unit and hierarchy conflict','image gates and bounded admission','revocation and stale batch','independent usage receipts','no automatic business writes']}));
  }finally{delete process.env.AI_IMAGE_INTAKE_ENABLED;if(app)await app.close();if(f)await cleanupFixture(db,f);await db.$disconnect();if(server)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
