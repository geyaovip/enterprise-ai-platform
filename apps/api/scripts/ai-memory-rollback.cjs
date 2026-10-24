// Maintenance helper for rolling back to API versions that do not understand memoryRefs.
// Back up first and stop API/Worker before --apply. No memory text is printed.
const {PrismaService}=require('../dist/modules/prisma.service');
const hidden='该回答使用的记忆已修改、删除或过期，正文不再用于续聊。';
async function redactInvalidMemory(db,{tenantId,dryRun=true}={}){
 const where=tenantId?{tenantId}:{};const rows=await db.aiMemoryEntry.findMany({where,select:{id:true,tenantId:true,appId:true,ownerUserId:true,visibility:true,version:true,expiresAt:true}}),byId=new Map(rows.map(r=>[r.id,r]));const now=Date.now();
 const valid=(refs,scope)=>!Array.isArray(refs)||refs.every(ref=>{const r=byId.get(ref.id);return r&&r.version===ref.version&&r.tenantId===scope.tenantId&&r.appId===scope.appId&&(!r.expiresAt||r.expiresAt.getTime()>now)&&(r.visibility==='enterprise'&&r.ownerUserId===null||r.visibility==='personal'&&r.ownerUserId===scope.userId);});
 let conversations=0,messages=0,tasks=0,cursor;
 do{const batch=await db.aiConversation.findMany({where,orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{})});if(!batch.length)break;
  for(const c of batch){let changed=0;const list=Array.isArray(c.messages)?c.messages.map(m=>{if(m.role!=='assistant'||valid(m.memoryRefs,c))return m;changed++;const {process,citations,sources,context,...rest}=m;return {...rest,content:hidden,memoryRefs:[]};}):c.messages;
   if(changed){conversations++;messages+=changed;if(!dryRun){const result=await db.aiConversation.updateMany({where:{id:c.id,version:c.version},data:{messages:list,version:{increment:1}}});if(result.count!==1)throw Error('Conversation changed; keep API/Worker stopped and review');await db.aiContextSummary.deleteMany({where:{conversationId:c.id}});}}
  }cursor=batch.at(-1).id;
 }while(true);
 cursor=undefined;
 do{const batch=await db.aiTask.findMany({where:{...where,kind:'message'},orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{})});if(!batch.length)break;
  for(const task of batch){const value=task.result;if(!value||typeof value!=='object'||valid(value.memoryRefs,task)&&valid(value.message?.memoryRefs,task))continue;tasks++;if(!dryRun){const {progress,...rest}=value;await db.aiTask.update({where:{id:task.id},data:{result:{...rest,partialText:'',citationIds:[],memoryRefs:[],...(value.message?{message:{role:'assistant',content:hidden,memoryRefs:[]}}:{})}}});}}
  cursor=batch.at(-1).id;
 }while(true);
 return {dryRun,conversations,messages,tasks};
}
if(require.main===module){(async()=>{const db=new PrismaService();try{const apply=process.argv.includes('--apply');if(apply){if(process.env.AI_MEMORY_ROLLBACK_MAINTENANCE!=='1')throw Error('Back up and stop API/Worker, then set AI_MEMORY_ROLLBACK_MAINTENANCE=1');const active=await db.aiExecution.count({where:{status:{in:['queued','preparing','running']}}})+await db.aiTask.count({where:{status:{in:['queued','running']}}});if(active)throw Error('Active AI work must finish before rollback');}console.log(JSON.stringify({at:new Date().toISOString(),...await redactInvalidMemory(db,{dryRun:!apply})}));}finally{await db.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={redactInvalidMemory};
