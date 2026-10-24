const assert=require('node:assert/strict');
const {WorkflowService}=require('../dist/modules/erp/workflow.service');
(async()=>{
 const messages=[];const tx={membership:{findMany:async()=>[{id:'active-member',role:'admin',user:{name:'Test'}}]},erpNotification:{createMany:async({data})=>messages.push(...data)},channelConnection:{findUnique:async()=>null}};
 const service=new WorkflowService({},{}),flow={id:'flow',tenantId:'tenant',cycle:1,cursor:1,version:2,resourceNumber:'TEST-PO',dueAt:new Date('2026-10-10T04:30:00Z')};
 await service.alert(tx,flow,['active-member','unavailable'],'completed','TEST-PO · 办理完成');assert.equal(messages.length,1);assert.match(messages[0].body,/已完成/);assert.doesNotMatch(messages[0].body,/请处理|截止/);
 await service.alert(tx,flow,['active-member'],'entered','TEST-PO · 采购入库待处理');assert.match(messages[1].body,/请处理/);assert.match(messages[1].body,/12:30:00（北京时间）/);assert.doesNotMatch(messages[1].body,/T04:30:00.*Z/);
 await service.alert(tx,flow,['active-member'],'rejected','TEST-PO · 已退回','请补充交期');assert.equal(messages[2].body,'请补充交期');
 console.log('Workflow notification: completion semantics, readable deadline, explicit reason and recipient filtering passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
