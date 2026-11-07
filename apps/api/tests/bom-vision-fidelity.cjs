// Hybrid routing and source-preserving payload boundaries; no paid model calls.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const{GLM,KIMI,visionTimeout,visionPayload,BomVisionProvider,PROMPT_SHA}=require('../dist/modules/mes/bom-vision.provider');
const{primaryVisionModel,automaticKimiRecheck,sameVisionFacts}=require('../dist/modules/mes/bom-vision-policy');
const{BOM_VISION_PROMPT}=require('../dist/modules/mes/bom-vision-prompt');
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
(async()=>{const oldFirst=process.env.BOM_VISION_GLM_FIRST,oldKimi=process.env.BOM_VISION_KIMI_ENABLED;delete process.env.BOM_VISION_GLM_FIRST;delete process.env.BOM_VISION_KIMI_ENABLED;
try{
 const p={width:3000,height:2400,nativeTables:[],risk:{dense:false,distorted:false,lowContrast:false},hasPartsHeader:false},row={item:'1',part:null,mpn:null,name:'COMPONENT',qty:'1',quantities:{},sourceQty:'1'},a={bomPresent:true,variants:[],uncertainties:[],rows:[row]};
 eq(primaryVisionModel(p),GLM);
 for(const k of ['dense','distorted','lowContrast'])eq(primaryVisionModel({...p,risk:{...p.risk,[k]:true}}),KIMI);
 eq(automaticKimiRecheck({...a,rows:Array.from({length:40},(_,i)=>({...row,item:String(i+1)}))},p),true);
 process.env.BOM_VISION_GLM_FIRST='true';eq(primaryVisionModel({...p,risk:{...p.risk,dense:true}}),GLM);
 eq(visionTimeout(GLM),300000);eq(visionTimeout(KIMI),360000);
 eq(automaticKimiRecheck({...a,rows:[{...row,name:null,part:null,mpn:null,spec:'printed component name'}]},p),true);
 eq(automaticKimiRecheck({...a,rows:[{...row,qty:null,sourceQty:null}]},p),true);
 eq(automaticKimiRecheck({...a,variants:['8B','12B']},p),true);
 eq(automaticKimiRecheck({...a,rows:[{...row,sourceQty:'7'}]},p),true);
 eq(automaticKimiRecheck(a,p),false);
 eq(automaticKimiRecheck({...a,rows:Array.from({length:40},(_,i)=>({...row,item:String(i+1)}))},p),false);
 eq(automaticKimiRecheck({...a,rows:[{...row,qty:null,sourceQty:'A/R'}]},p),false);
 eq(automaticKimiRecheck({...a,variants:['A','B'],rows:[{...row,qty:null,sourceQty:null,quantities:{A:'0',B:''}}]},p),false);
 eq(automaticKimiRecheck({...a,rows:[{...row,qty:'1',quantities:{A:'2'}}]},p),true);
 eq(automaticKimiRecheck({...a,uncertainties:['row 1 illegible']},p),true);
 eq(automaticKimiRecheck({...a,rows:Array.from({length:38},(_,i)=>({...row,item:String(i+1),name:'PART V'+i}))},p),true);
 process.env.BOM_VISION_KIMI_ENABLED='false';eq(primaryVisionModel({...p,risk:{...p.risk,dense:true}}),GLM);eq(automaticKimiRecheck(null,p),false);delete process.env.BOM_VISION_KIMI_ENABLED;
 eq(sameVisionFacts(a,{...a,rows:[{...row,name:'COMPONENT V1'}]}),false);
 const image=Buffer.from('original'),main=visionPayload(GLM,image),second=visionPayload(KIMI,image);
 for(const payload of [main,second]){eq(payload.messages[0].content[0].text,BOM_VISION_PROMPT);eq(payload.messages[0].content.filter(c=>c.type==='image_url').length,1);eq(payload.reasoning_effort,'low');}
 eq(second.messages[0].content[1].image_url.url,main.messages[0].content[1].image_url.url);eq(PROMPT_SHA.length,64);
 Object.assign(process.env,{NODE_ENV:'test',NATIVE_AI_MODEL_ENABLED:'true',BOM_VISION_ENABLED:'true',BOM_VISION_API_KEY:'fake-not-dispatched',BOM_VISION_BASE_URL:'http://127.0.0.1:9'});
 let dbCalls=0;const provider=new BomVisionProvider({$transaction:()=>{dbCalls++;throw Error('invalid payload must not reserve');}}),scope={tenantId:randomUUID(),membershipId:randomUUID(),jobId:randomUUID(),attempt:1,pageIndex:0,slot:0};
 for(const model of [GLM,KIMI]){await assert.rejects(()=>provider.run(scope,model,Buffer.alloc(8388609),AbortSignal.abort()),e=>e.code==='BOM_VISION_INPUT_INVALID');checks++;}
 process.env.BOM_VISION_KIMI_ENABLED='false';await assert.rejects(()=>provider.run(scope,KIMI,image,AbortSignal.abort()),e=>e.code==='BOM_VISION_RECHECK_DISABLED');checks++;eq(dbCalls,0);
 console.log(JSON.stringify({passed:true,assertions:checks,realModelCalls:0,coverage:['default hybrid routing to Kimi for risky pages','optional explicit GLM-first','Kimi recheck and disable boundaries','same tested base prompt and complete source for both models','invalid input cannot reserve','bounded model-specific timeouts']}));
}finally{for(const[k,v]of[['BOM_VISION_GLM_FIRST',oldFirst],['BOM_VISION_KIMI_ENABLED',oldKimi]])if(v===undefined)delete process.env[k];else process.env[k]=v;}})().catch(e=>{console.error(e);process.exitCode=1;});
