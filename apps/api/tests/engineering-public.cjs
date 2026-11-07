// Fixed public-source regression, independent cell ground truth retained from D-092.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {parseNativeDocument}=require('../dist/modules/knowledge/native-parser');
const {engineeringQuery,queryTerms,matchesTerm,hybridCandidates,localRerank,diverseResults,adjacentEvidence}=require('../dist/modules/knowledge/native-ranking');
const {MesBomIntakeService}=require('../dist/modules/mes/bom-intake.service');
const root=path.resolve(__dirname,'../../..'),base=path.join(root,'var/operations/20261027-wenwen-review'),out=process.env.NATIVE_QA_OUTPUT_DIR;
assert.ok(out&&/20261028-(bom-quality|pcb-validation)/.test(out));fs.mkdirSync(out,{recursive:true});
const service=new MesBomIntakeService({guard:async()=>{},db:{mesMaterial:{findMany:async()=>[]}}}),ctx={tenantId:'isolated-engineering-public',membershipId:'local',app:{appId:'mes'}};
let networkCalls=0;global.fetch=async()=>{networkCalls++;throw Error('No model network is permitted in this public parser test');};
const report={date:new Date().toISOString(),files:[],retrieval:[],modelCalls:0},corpus=[];
const expected=JSON.parse(fs.readFileSync(path.join(base,'derived/bbb-bom-ground-truth.json'))).rows;
const save=()=>fs.writeFileSync(path.join(out,'public-results.json'),JSON.stringify(report,null,2));
(async()=>{
 const inputs=[...fs.readdirSync(path.join(base,'sources')).filter(x=>/\.(pdf|xls|xlsx|step|dsn|PcbDoc|SchDoc|jpg)$/.test(x)).map(x=>['sources',x]),...['bbb-bom-1.csv','bbb-bom-canonical.csv','bbb-bom-canonical.xlsx','bbb-schematic-p1.png','nist-ftc-06-p1.png','rice-agc-schematic-p1.png'].map(x=>['derived',x])];
 for(const [folder,filename]of inputs){
  const bytes=fs.readFileSync(path.join(base,folder,filename)),r={filename,folder,inputSha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')};
  try{const chunks=await parseNativeDocument(filename,bytes);r.knowledge={status:'parsed',chunks:chunks.length,characters:chunks.reduce((n,x)=>n+x.text.length,0)};fs.writeFileSync(path.join(out,filename+'.knowledge.json'),JSON.stringify(chunks,null,2));chunks.forEach((x,i)=>corpus.push({...x,datasetId:filename,documentId:filename,title:filename,ordinal:i,distance:null,dimension:0}));}
  catch(e){r.knowledge={status:'rejected',code:e.code??e.name};}
  try{const bom=await service.intake(ctx,{kind:'bom',source:{documents:[{filename,data:bytes.toString('base64'),productCode:filename.startsWith('bbb-')?'BeagleBone Black':undefined}]}});r.bom={status:'parsed',rows:bom.totalRows};fs.writeFileSync(path.join(out,filename+'.bom.json'),JSON.stringify(bom,null,2));
   if(filename.startsWith('nist-'))assert.equal(bom.totalRows,0,'No PMI/drawing dimensions may be invented into BOM');
   if(filename==='bbb-bom.xls'){
    const lines=bom.groups.flatMap(g=>g.lines);assert.equal(lines.length,73);
    r.bom.exact=expected.filter((row,i)=>{const l=lines[i];return l.sku===row[0].normalize('NFKC')&&l.name===row[1].normalize('NFKC')&&l.quantity===row[4]&&l.mpn===row[3].normalize('NFKC')&&l.manufacturer===row[2].normalize('NFKC')&&l.sourceDesignators===row[5];}).length;
    assert.equal(r.bom.exact,73);assert.equal(lines.reduce((n,l)=>n+l.designators.length,0),418);assert.ok(lines.every(l=>!l.conflict&&!l.doNotPopulate));
   }
  }catch(e){if(e instanceof assert.AssertionError)throw e;r.bom={status:'rejected',code:e.code??e.name};}
  report.files.push(r);save();console.log(JSON.stringify(r));
 }
 for(const name of ['bbb-schematic.pdf','rice-agc-schematic.pdf','bbb-bom.xls'])assert.equal(report.files.find(x=>x.filename===name).knowledge.status,'parsed');
 // The official manual is a plain-text source export, not a substitute for the PDF tests above.
 const name='bbb-manual-history.txt',chunks=await parseNativeDocument(name,fs.readFileSync(path.join(base,'derived',name)));
 chunks.forEach((x,i)=>corpus.push({...x,datasetId:name,documentId:name,title:name,ordinal:i,distance:null,dimension:0}));
 const probes=[['IT66122FN',['IT66122FN'],'bbb-bom.xls'],['SN74LVC1G07DCKR U16',['SN74LVC1G07DCKR','U16'],'bbb-bom.xls'],['C24 C25 2.2uF',['C24','C25'],null],['D1 HDMI ITE IT66122',['IT66122FN'],'bbb-schematic.pdf'],['R7 R8 59 Ohm',['R7','R8'],'rice-agc-schematic.pdf'],['NX1117CE33Z U1',['NX1117CE33Z','U1'],'rice-agc-schematic.pdf'],['NOSUCHPART-999999',[],null]];
 for(const [query,needles,scope]of probes){const terms=queryTerms(query),family=engineeringQuery(query),rows=corpus.map(r=>({...r,lexical:terms.reduce((n,t)=>n+(matchesTerm(r.text,t.text,family)?t.weight:0),0)}));const picked=adjacentEvidence(diverseResults(localRerank(hybridCandidates(rows,query),query)),rows,query);const scoped=picked.filter(x=>!scope||x.documentId===scope);const hit=needles.length?needles.every(n=>scoped.some(x=>matchesTerm(x.text,n.toLowerCase(),family))):picked.length===0;report.retrieval.push({query,needles,scope,hit,returned:picked.length,evidence:picked.map(x=>({filename:x.documentId,text:x.text,locator:x.locator}))});}
 assert.equal(networkCalls,0);save();console.log(JSON.stringify({rows:73,retrieval:report.retrieval.map(({evidence,...r})=>r),modelCalls:0}));
 assert.ok(report.retrieval.every(x=>x.hit),'See public-results.json for actual regression misses');
})().catch(e=>{save();console.error(e);process.exitCode=1});
