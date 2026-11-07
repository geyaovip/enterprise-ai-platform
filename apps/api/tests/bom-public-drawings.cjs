// Local parser benchmark; public ground truth is separate from synthetic API controls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MesBomIntakeService}=require('../dist/modules/mes/bom-intake.service');
const root=path.resolve(__dirname,'../../..'),base=path.join(root,'output/pdf/public-drawing-ocr-20261027'),out=process.env.BOM_QA_OUTPUT_DIR??path.join(root,'output/bom-intake-20261027');
fs.mkdirSync(out,{recursive:true});
const expected=JSON.parse(fs.readFileSync(path.join(base,'ground-truth.json'))).rows;
const compact=s=>String(s??'').normalize('NFKC').replace(/\s/g,'').toUpperCase();
const service=new MesBomIntakeService({guard:async()=>{},db:{mesMaterial:{findMany:async()=>[]}}});
const ctx={tenantId:'isolated-parser-benchmark',membershipId:'local',app:{appId:'mes'}};
const results=[];
(async()=>{
 for(const name of ['technical','jackscrew','shaker','drawer']){
  const result=await service.intake(ctx,{kind:'bom',source:{documents:[{filename:name+'.pdf',data:fs.readFileSync(path.join(base,'sources',name+'.pdf')).toString('base64')}]}});
  fs.writeFileSync(path.join(out,'public-'+name+'-result.json'),JSON.stringify(result,null,2));
  if(name==='technical'){assert.equal(result.totalRows,0);results.push({sample:name,mode:'pdf',noInventedBom:true});continue;}
  for(const [sample,rows]of Object.entries(expected).filter(([s])=>s.startsWith(name+'-'))){
   const page=Number(sample.split('-p')[1]);
   const got=result.groups.flatMap(g=>g.lines).filter(l=>l.locator.page===page);
   const checks=rows.map(row=>{const item=row[0],qty=name==='drawer'?row[2]:row[1],sku=name==='drawer'?row[1]:row[2];const hit=got.some(line=>compact(line.sku)===compact(sku)&&(line.quantity===qty||line.quantity===null&&line.sourceQuantity===qty&&line.conflict&&line.reviewReasons.some(x=>x.includes('置信不足')))&&compact(line.sourceCells[0])===compact(item));const exactQuantity=got.some(line=>compact(line.sku)===compact(sku)&&line.quantity===qty&&compact(line.sourceCells[0])===compact(item));return {item,sku,qty,hit,exactQuantity};});
   results.push({sample,mode:'pdf',hit:checks.filter(x=>x.hit).length,total:rows.length,checks});
  }
 }
 for(const [sample,rows]of Object.entries(expected)){
  const filename=sample+'-2000.png';
  const result=await service.intake(ctx,{kind:'bom',source:{documents:[{filename,data:fs.readFileSync(path.join(base,'results',filename)).toString('base64')}]}});
  fs.writeFileSync(path.join(out,'public-'+sample+'-png-result.json'),JSON.stringify(result,null,2));
  const got=result.groups.flatMap(g=>g.lines);
  const checks=rows.map(row=>{const item=row[0],qty=sample.startsWith('drawer')?row[2]:row[1],sku=sample.startsWith('drawer')?row[1]:row[2];const hit=got.some(line=>compact(line.sku)===compact(sku)&&(line.quantity===qty||line.quantity===null&&line.sourceQuantity===qty&&line.conflict&&line.reviewReasons.some(x=>x.includes('置信不足')))&&compact(line.sourceCells[0])===compact(item));const exactQuantity=got.some(line=>compact(line.sku)===compact(sku)&&line.quantity===qty&&compact(line.sourceCells[0])===compact(item));return {item,sku,qty,hit,exactQuantity};});
  results.push({sample,mode:'png-2000',hit:checks.filter(x=>x.hit).length,total:rows.length,checks});
 }
 fs.writeFileSync(path.join(out,'public-evaluation.json'),JSON.stringify({metric:'exact item, quantity and part-number cells; whitespace and letter case normalized; not full-page OCR accuracy or production acceptance',results},null,2));
 console.log(JSON.stringify({samples:results.map(r=>({sample:r.sample,mode:r.mode,hit:r.hit,total:r.total,noInventedBom:r.noInventedBom})),modelCalls:0}));
 assert.ok(results.every(r=>r.noInventedBom||r.hit===r.total),'See public-evaluation.json for identity or non-empty quantity errors; explicit low-confidence blanks are separately recorded');
})().catch(error=>{console.error(error);process.exitCode=1});
