const assert=require('node:assert/strict'),http=require('node:http'),{spawnSync}=require('node:child_process'),fs=require('node:fs');
const {parseNativeDocument}=require('../dist/modules/knowledge/native-parser'),{queryTerms,hybridCandidates,diverseResults,localRerank}=require('../dist/modules/knowledge/native-ranking'),{NativeEmbedding}=require('../dist/modules/knowledge/native-embedding'),{infrastructureSecret}=require('../dist/modules/platform/infrastructure-contract');
(async()=>{
 let checks=0;const ok=(v,msg)=>{assert.ok(v,msg);checks++;};
 const csv=await parseNativeDocument('quoted.csv',Buffer.from('\uFEFF料号,说明,数量\nSKU-1,"第一行\n第二行,含逗号",2\nSKU-10,"带""引号""",9'));
 ok(csv.some(c=>c.text.includes('第二行,含逗号')&&c.text.includes('料号')));ok(csv.some(c=>c.text.includes('带"引号"')));
 await assert.rejects(()=>parseNativeDocument('bad.csv',Buffer.from('a,"b')),e=>e.code==='DOCUMENT_INVALID');checks++;
 const py=spawnSync(process.env.KNOWLEDGE_PYTHON_PATH,['-c',`
import io,json,base64,zipfile
from PIL import Image,ImageDraw,ImageFont
from reportlab.pdfgen import canvas
im=Image.new('RGB',(1600,300),'white');ImageDraw.Draw(im).text((30,70),'SKU-1 QUANTITY 24680',font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',75),fill='black')
out=io.BytesIO();c=canvas.Canvas(out,pagesize=(1600,400));from reportlab.lib.utils import ImageReader
c.drawImage(ImageReader(im),0,100,width=1600,height=300);c.setFont('Helvetica',18);c.drawString(20,25,'Document page 1');c.save()
z=io.BytesIO()
with zipfile.ZipFile(z,'w')as a:
 a.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sparse" r:id="rId1"/></sheets></workbook>')
 a.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
 a.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>料号</t></is></c><c r="B1" t="inlineStr"><is><t>名称</t></is></c><c r="C1" t="inlineStr"><is><t>数量</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>SKU-1</t></is></c><c r="C2"><v>9</v></c></row><row r="3"><c r="C3"><f>SUM(C2:C2)</f></c></row></sheetData></worksheet>')
print(json.dumps({'pdf':base64.b64encode(out.getvalue()).decode(),'xlsx':base64.b64encode(z.getvalue()).decode()}))`],{encoding:'utf8',maxBuffer:2*1024*1024});assert.equal(py.status,0,py.stderr);const fixtures=JSON.parse(py.stdout);
 const pdf=await parseNativeDocument('scan-with-footer.pdf',Buffer.from(fixtures.pdf,'base64'));ok(pdf.some(c=>c.locator.ocr&&c.text.includes('24680')),JSON.stringify(pdf));ok(pdf.some(c=>c.text.includes('Document page 1')));
 const xlsx=await parseNativeDocument('sparse.xlsx',Buffer.from(fixtures.xlsx,'base64'));ok(xlsx.some(c=>c.text.includes('SKU-1 |  | 9')),JSON.stringify(xlsx));ok(xlsx.some(c=>c.text.includes('公式结果未缓存')&&c.text.includes('SUM(C2:C2)')));
 ok(queryTerms('采购').find(t=>t.text==='采购').weight===2);
 const row=(documentId,ordinal,text)=>({datasetId:documentId,documentId,ordinal,text,locator:{},distance:0.1,lexical:1,dimension:2});
 const exact=hybridCandidates([row('a',0,'SKU-10 用量9'),row('b',0,'ＳＫＵ－１ 用量2')],'SKU-1');ok(exact.length===1&&exact[0].documentId==='b');
 ok(hybridCandidates([row('a',0,'SKU-10')],'SKU-404').length===0);
 const many=[...Array.from({length:10},(_,i)=>row('long',i,'采购审批不同段落'+i)),row('short',0,'采购审批补充要求')];ok(diverseResults(many).slice(0,3).some(x=>x.documentId==='short'));
 ok(localRerank([{text:'相关',title:'采购审批标准'},{text:'无关',title:'无关'}],'采购审批')[0].title==='采购审批标准');
 let mode='reverse',calls=0;const mock=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);calls++;let data=body.input.map((text,index)=>({index,embedding:[index+1,1]})).reverse();if(mode==='duplicate')data=data.map(x=>({...x,index:0}));if(mode==='zero')data[0].embedding=[0,0];if(mode==='json'){res.end('broken');return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({data}));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 try{const embedding=new NativeEmbedding({baseUrl:'http://127.0.0.1:'+mock.address().port,secretCiphertext:infrastructureSecret('synthetic-knowledge'),options:{embeddingModel:'synthetic',embeddingFormat:'openai'}});const values=await embedding.embedMany(Array.from({length:33},(_,i)=>''+i));ok(values.length===33&&calls===3);ok(values[0][0]===values[0][1]&&values[1][0]>values[1][1]);for(const invalid of ['duplicate','zero','json']){mode=invalid;await assert.rejects(()=>embedding.embedMany(['a','b']),e=>e.code==='EMBEDDING_INVALID');checks++;}}
 finally{await new Promise(r=>mock.close(r));}
 const {ModelGateway}=require('../dist/modules/ai/model.gateway');
 const oldSelected=process.env.NATIVE_CHAT_MODEL_ID;process.env.NATIVE_CHAT_MODEL_ID='deepseek-v4-1-flash-economy-261017';
 const target='doubao-seed-evolving',ark='https://ark.cn-beijing.volces.com/api/v3';
 const stored={model:target,baseUrl:ark,keyCiphertext:infrastructureSecret('synthetic-private-key')},ledgers=[];
 const gateway=new ModelGateway({aiProviderSettings:{findUnique:async()=>stored},aiModelUsage:{create:async({data})=>ledgers.push(data),update:async()=>{}},aiUsage:{create:async()=>{}}},{});
 ok((await gateway.runtimeSettings('synthetic')).model===target);ok((await gateway.status({tenantId:'synthetic'})).model===target);ok(stored.model===target);
 const savedFetch=global.fetch;let payload;
 global.fetch=async(url,args)=>{payload=JSON.parse(args.body);return {ok:true,json:async()=>({model:target,choices:[{message:{content:'READY'}}],usage:{prompt_tokens:9,completion_tokens:2,total_tokens:11}})};};
 try{ok(await gateway.complete({tenantId:'synthetic',membershipId:'synthetic',userId:'synthetic',requestId:'synthetic',app:{appId:'erp'}},[{role:'user',content:'probe'}])==='READY');ok(payload.model===target&&payload.thinking.type==='disabled'&&payload.max_tokens<=2048);ok(ledgers[0].requestedModel===target);}
 finally{global.fetch=savedFetch;if(oldSelected===undefined)delete process.env.NATIVE_CHAT_MODEL_ID;else process.env.NATIVE_CHAT_MODEL_ID=oldSelected;}
 const report={at:new Date().toISOString(),assertions:checks,ocr:'real Tesseract + Poppler',pdf:'raster body with selectable footer',tables:'CSV quoted multiline and sparse XLSX with missing formula cache',embedding:'synthetic; batching/order/invalid protocol'};fs.writeFileSync('../../output/knowledge-rag-20261027/quality.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
