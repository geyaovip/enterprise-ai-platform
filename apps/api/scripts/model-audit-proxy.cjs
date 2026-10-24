// Isolated paid QA only. Records physical provider requests without storing prompts/keys.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{randomBytes,randomUUID}=require('node:crypto');
const {PaidTestBudget}=require('./paid-test-budget.cjs');
const out=path.resolve(process.env.MODEL_TEST_OUTPUT_DIR||process.env.CRM_TEST_OUTPUT_DIR||'../../output/ai-usage-fix-20261023');
fs.mkdirSync(out,{recursive:true,mode:0o700});
const file=path.join(out,'provider-usage.jsonl');
const previous=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
if(previous.length&&process.env.MODEL_AUDIT_RESUME!=='1')throw Error('Provider ledger already exists; review it before starting another paid budget');
const model=process.env.MODEL_TEST_MODEL||process.env.CRM_REAL_MODEL||'doubao-seed-evolving';
const root=path.resolve(__dirname,'../../..');
const settings=JSON.parse(fs.readFileSync(process.env.MODEL_TEST_SETTINGS_FILE||path.join(root,'var/ark-model.json')));
const upstream=new URL(settings.baseUrl);
if(upstream.protocol!=='https:'||upstream.hostname!=='ark.cn-beijing.volces.com')throw Error('Unexpected provider host');
const secret=previous.length?JSON.parse(fs.readFileSync(path.join(out,'proxy.private.json'))).apiKey:randomBytes(32).toString('hex');
const budget=new PaidTestBudget({maxCalls:Number(process.env.MODEL_TEST_MAX_CALLS||process.env.CRM_TEST_MAX_CALLS||24),maxTokens:Number(process.env.MODEL_TEST_MAX_TOKENS||process.env.CRM_TEST_MAX_TOKENS||100000),file});
const maxOutput=Number(process.env.MODEL_TEST_MAX_OUTPUT||2000);
if(!Number.isInteger(maxOutput)||maxOutput<1||maxOutput>2000)throw Error('Invalid output budget');
if(previous.length){
 const responses=previous.filter(r=>r.type==='response');
 // Resume only a diagnosed request-format failure, preserving attempts and a
 // conservative reservation for its unknown tokens. No automatic error retry.
 if(responses.some(r=>!(r.status===200&&r.usageStatus==='reported')&&r.status!==400)||previous.filter(r=>r.type==='request_started').at(-1)?.attempt!==responses.at(-1)?.attempt||previous.some(r=>r.requestedModel&&r.requestedModel!==model))throw Error('Only diagnosed schema/budget stops may resume this budget');
 budget.calls=previous.filter(r=>r.type==='request_started').length;
 budget.knownTokens=responses.reduce((n,r)=>n+(r.totalTokens??((r.inputTokens??0)+(r.outputTokens??0))),0);
 const unknownAttempts=new Set(responses.filter(r=>r.usageStatus==='unknown').map(r=>r.attempt));
 budget.reservedUnknownTokens=previous.filter(r=>r.type==='request_started'&&unknownAttempts.has(r.attempt)).reduce((n,r)=>n+r.inputBytes+r.maxOutputTokens+1024,0);
 append({type:'resume_after_schema_fix',at:new Date().toISOString(),previousAttempts:budget.calls,unknownTokenReservation:budget.reservedUnknownTokens});
}
let busy=false,stopped=false;
function append(record){const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function usageFrom(body){
 const records=[];try{records.push(JSON.parse(body));}catch{for(const line of body.split(/\r?\n/)){if(line.startsWith('data: '))try{records.push(JSON.parse(line.slice(6)));}catch{}}}
 const item=records.findLast(r=>r.usage)||records.at(-1)||{},usage=item.usage||{};
 return {externalId:item.id,model:item.model,inputTokens:usage.prompt_tokens,outputTokens:usage.completion_tokens,totalTokens:usage.total_tokens,
  cachedInputTokens:usage.prompt_tokens_details?.cached_tokens,reasoningTokens:usage.completion_tokens_details?.reasoning_tokens};
}
const server=http.createServer(async(req,res)=>{
 const deny=(status,code)=>{res.writeHead(status,{'content-type':'application/json','retry-after':'0'});res.end(JSON.stringify({error:{code,message:code}}));};
 if(req.headers.authorization!=='Bearer '+secret)return deny(401,'QA_PROXY_AUTH');
 if(req.method!=='POST'||!req.url.endsWith('/chat/completions'))return deny(404,'QA_PROXY_ROUTE');
 if(busy||stopped)return deny(400,'QA_PROXY_STOPPED');
 let raw='',request,attempt,started,ownsBusy=false;
 try{
  for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>200000)throw Error('QA_REQUEST_TOO_LARGE');}
  request=JSON.parse(raw);if(request.model!==model)throw Error('QA_UNEXPECTED_MODEL');
  if(busy||stopped)return deny(400,'QA_PROXY_STOPPED');
  request.thinking={type:'disabled'};
  const outputLimit=Math.min(request.max_completion_tokens??request.max_tokens??maxOutput,maxOutput);
  if(request.max_completion_tokens!==undefined){request.max_completion_tokens=outputLimit;delete request.max_tokens;}
  else request.max_tokens=outputLimit;
  if(request.stream)request.stream_options={...request.stream_options,include_usage:true};
  // Conservative byte-based reservation plus output/framing allowance; real usage is
  // checked again after the response. Calls are serialized and never retried here.
  const body=JSON.stringify(request),reserved=Buffer.byteLength(body)+outputLimit+1024;
  if(budget.knownTokens+(budget.reservedUnknownTokens||0)+reserved>budget.maxTokens)throw Error('QA_TOKEN_RESERVATION_STOP');
  attempt=budget.begin();busy=true;ownsBusy=true;started=Date.now();
  append({type:'request_started',at:new Date().toISOString(),attempt,requestedModel:model,inputBytes:Buffer.byteLength(body),messageCount:request.messages?.length,toolCount:request.tools?.length,maxOutputTokens:outputLimit,thinking:'disabled'});
  const response=await fetch(upstream.href.replace(/\/$/,'')+'/chat/completions',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+settings.apiKey,'content-type':'application/json'},body,signal:AbortSignal.timeout(120000)});
  const text=await response.text(),usage=usageFrom(text);
  const known=Number.isSafeInteger(usage.inputTokens)&&Number.isSafeInteger(usage.outputTokens);
  const receipt=budget.record({type:'response',attempt,at:new Date().toISOString(),requestedModel:model,status:response.status,elapsedMs:Date.now()-started,providerRequestId:response.headers.get('x-tt-logid')||response.headers.get('x-request-id'),...usage,usageStatus:known?'reported':'unknown'});
  if(!response.ok||!known)stopped=true;
  res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json'});res.end(text);
  console.log(JSON.stringify({attempt,status:response.status,inputTokens:receipt.inputTokens,outputTokens:receipt.outputTokens,knownTokens:budget.knownTokens}));
 }catch(error){
  if(attempt){budget.record({type:'response',attempt,at:new Date().toISOString(),requestedModel:model,usageStatus:'unknown',errorCode:error.name});stopped=true;}
  if(!res.headersSent)deny(error.message.startsWith('QA_')?400:503,error.message.startsWith('QA_')?error.message:'QA_PROVIDER_UNAVAILABLE');else res.end();
 }finally{if(ownsBusy)busy=false;}
});
server.listen(Number(process.env.MODEL_AUDIT_PORT||18807),process.env.MODEL_AUDIT_HOST||'127.0.0.1',()=>{
 fs.writeFileSync(path.join(out,'proxy.private.json'),JSON.stringify({baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:secret,model}),{mode:0o600});
 console.log(JSON.stringify({ready:true,port:server.address().port,model,maxCalls:budget.maxCalls,maxTokens:budget.maxTokens}));
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
