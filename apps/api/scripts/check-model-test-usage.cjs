const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PrismaService}=require('../dist/modules/prisma.service');
(async()=>{
 const out=path.resolve(process.argv[2]);const events=fs.readFileSync(path.join(out,'provider-usage.jsonl'),'utf8').trim().split('\n').map(JSON.parse),starts=events.filter(r=>r.type==='request_started'),responses=events.filter(r=>r.type==='response'),known=responses.filter(r=>r.usageStatus==='reported');
 assert.equal(new Set(starts.map(r=>r.attempt)).size,starts.length);assert.equal(starts.length,responses.length);assert.ok(starts.length<=12);
 for(const r of known){assert.equal(r.status,200);assert.equal(r.inputTokens+r.outputTokens,r.totalTokens);assert.ok(r.model.startsWith('doubao-seed-evolving'));}
 const ledger=new Map();for(const file of fs.readdirSync(out).filter(f=>/^ledger-.*\.json$/.test(f))){for(const r of JSON.parse(fs.readFileSync(path.join(out,file))).records)ledger.set(r.id,r);}
 const reported=[...ledger.values()].filter(r=>r.usageStatus==='reported');let matchedPhysical=0;
 for(const row of reported){
  const matches=known.filter(r=>{const start=starts.find(s=>s.attempt===r.attempt);return Date.parse(start.at)>=Date.parse(row.createdAt)-5&&Date.parse(r.at)<=Date.parse(row.finishedAt)+5;});
  assert.ok(matches.length>0,'Reported runtime missing physical receipt');assert.equal(matches.reduce((n,r)=>n+r.totalTokens,0),row.totalTokens);matchedPhysical+=matches.length;
 }
 assert.equal(matchedPhysical,known.length);assert.equal(reported.reduce((n,r)=>n+r.totalTokens,0),known.reduce((n,r)=>n+r.totalTokens,0));
 const db=new PrismaService();try{assert.equal(await db.aiModelUsage.count({where:{id:{in:[...ledger.keys()]}}}),ledger.size,'Usage did not survive fixture cleanup');}finally{await db.$disconnect();}
 const latest=new Map();for(const file of ['schema-failure-results.json','metrics-before-compact-results.json','before-rule-recovery-results.json','real-model-results.json']){
  const full=path.join(out,file);if(!fs.existsSync(full))continue;const report=JSON.parse(fs.readFileSync(full));for(const row of report.reports){const old=latest.get(row.case);if(!old||old.at<report.at)latest.set(row.case,{at:report.at,...row});}
 }
 const accepted=['AI-01-R1','AI-08-R1','AI-11-R1','AI-19-R1','AI-20-R1','AI-21-R1'].map(id=>latest.get(id));for(const r of accepted)assert.equal(r?.condition,'pass');
 let duplicateReads=0;for(const r of accepted){const seen=new Set();for(const tool of r.tools||[]){const key=JSON.stringify([tool.tool,tool.input,tool.result]);if(seen.has(key))duplicateReads++;seen.add(key);}}assert.equal(duplicateReads,0);
 const clock=JSON.parse(fs.readFileSync(path.join(out,'clock-model-result.json')));assert.equal(clock.ok,true);assert.equal(clock.answer.state,'usable');
 const result={at:new Date().toISOString(),model:'doubao-seed-evolving',resolvedModels:[...new Set(known.map(r=>r.model))],physicalRequests:starts.length,http200:known.length,http400:responses.filter(r=>r.status===400).length,
  knownInputTokens:known.reduce((n,r)=>n+r.inputTokens,0),knownOutputTokens:known.reduce((n,r)=>n+r.outputTokens,0),knownTotalTokens:known.reduce((n,r)=>n+r.totalTokens,0),cachedInputTokensSubset:known.reduce((n,r)=>n+(r.cachedInputTokens||0),0),reasoningTokensSubset:known.reduce((n,r)=>n+(r.reasoningTokens||0),0),
  unknownPhysicalUsage:responses.filter(r=>r.usageStatus!=='reported').length,logicalRuntimeRows:ledger.size,unknownLogicalUsage:[...ledger.values()].filter(r=>r.usageStatus!=='reported').length,
  reportedLogicalAndPhysicalTokensAgree:true,retainedAfterFixtureCleanup:true,duplicateActualReadsInAcceptedCases:duplicateReads,
  acceptedCases:accepted.map(r=>({case:r.case,runtimeCalls:r.runtimeCalls,condition:r.condition})),clockCheck:'pass',
  budgets:{initialCalls:24,finalCalls:12,initialTokens:100000,finalTokens:130000,unknown400ConservativeReservation:39735},
  limitations:['All phases including failed debugging attempts are included in known tokens.','The 400 response has unknown usage, not zero.','An additional logical request was blocked by the local budget and generated no provider request; logical/physical unknown counts are not added together.','Synthetic fixed-clock data; not full CRM acceptance or a production release.','Provider bill and monetary cost are outside this check.']};
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
