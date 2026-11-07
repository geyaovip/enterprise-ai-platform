// Run against the retained D-110 controlled fixtures; never connects to a database/provider.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {MesBomIntakeService}=require('../dist/modules/mes/bom-intake.service');
const base=process.env.BOM_EXPANDED_INPUT_DIR;
assert.ok(base,'Set BOM_EXPANDED_INPUT_DIR to the D-110 sources directory');
const service=new MesBomIntakeService({guard:async()=>{},db:{mesMaterial:{findMany:async()=>[]}}});
const ctx={tenantId:'offline-camera-benchmark',membershipId:'local',app:{appId:'mes'}};
const checks=[];
async function intake(name){
 const raw=fs.readFileSync(path.join(base,name));
 const result=await service.intake(ctx,{kind:'bom',source:{documents:[{filename:name,data:raw.toString('base64')}]}});
 assert.equal(result.sources[0].sha256,createHash('sha256').update(raw).digest('hex'));
 checks.push(name+': original bytes fingerprint retained');
 return result;
}
(async()=>{
 const negative=await intake('camera-mpo-first.jpg');
 assert.equal(negative.totalRows,0,'The BOM in MPO frame two must not be read');
 checks.push('MPO secondary frame ignored');
 const bom=await intake('bom-mpo-first.jpg');
 assert.equal(bom.totalRows,3);
 assert.equal(bom.requiresReview,true);
 const expected=[['JACKSCREW BAR BASE','1'],['JACKSCREW PIN','1'],['M5 X 16MM - 92000A326','4']];
 const rows=bom.groups.flatMap(g=>g.lines);
 for(const [sku,quantity]of expected){
  const row=rows.find(r=>r.sku===sku);
  assert.ok(row,sku);assert.equal(String(row.quantity),quantity);assert.equal(row.conflict,true);
  checks.push(sku+': source identity/quantity and mandatory review retained');
 }
 for(const name of ['product-photo-01.jpg','product-photo-04.jpg','camera-30mp.jpg']){
  await assert.rejects(()=>intake(name),e=>e.getStatus?.()===400&&e.message==='图片超过1200万像素，请裁剪明细区域');
  checks.push(name+': explicit pixel limit, no generic damaged-file error');
 }
 console.log(JSON.stringify({checks,modelCalls:0,databaseCalls:0},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
