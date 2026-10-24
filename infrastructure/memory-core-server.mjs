// Private retrieval worker. Platform records are authoritative; OpenClaw indexes are disposable.
import http from 'node:http';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,rm,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const root=resolve(process.env.MEMORY_CORE_DATA_DIR??'/var/lib/suite-memory');
const runtime=resolve(process.env.OPENCLAW_ROOT??'/app');
const token=process.env.MEMORY_CORE_TOKEN??'';
if(token.length<24)throw Error('MEMORY_CORE_TOKEN must contain at least 24 characters');
const version=JSON.parse(await readFile(join(runtime,'package.json'),'utf8')).version;
if(version!=='2026.9.7')throw Error('Memory bridge requires the verified OpenClaw 2026.9.7 runtime');
await mkdir(root,{recursive:true,mode:0o700});
const hash=s=>createHash('sha256').update(s).digest('hex');
const cache=new Map();let tail=Promise.resolve(),queued=0;
const serial=async run=>{if(queued>=8)throw Error('BUSY');queued++;let release;const previous=tail;tail=new Promise(r=>release=r);try{await previous;return await run();}finally{queued--;release();}};
const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(s);
function scopePath(scope){if(!scope||!validId(scope.tenantId)||!validId(scope.appId)||(scope.userId!==undefined&&!validId(scope.userId)))throw Error('SCOPE');return join(root,hash(scope.tenantId),hash(scope.appId),...(scope.userId?[hash(scope.userId)]:[]));}
function watermarkPath(scope){scopePath(scope);return join(root,'revocations',hash(JSON.stringify([scope.tenantId,scope.appId,scope.userId??null])));}
async function watermark(scope){try{const value=Number(await readFile(watermarkPath(scope),'utf8'));if(!Number.isFinite(value)||value<0)throw Error('INVALID_WATERMARK');return value;}catch(error){if(error.code==='ENOENT')return 0;throw error;}}
// ASCII token projections avoid SQLite unicode61 treating a whole Chinese phrase as one token.
export function searchTokens(text){const tokens=(text.toLowerCase().match(/[a-z0-9]{2,}/g)??[]).filter(x=>x.length<50);for(const chunk of text.match(/[\p{Script=Han}]+/gu)??[]){const chars=[...chunk];if(chars.length===1)tokens.push('c'+Buffer.from(chunk).toString('hex'));for(let n=2;n<=3;n++)for(let i=0;i+n<=chars.length;i++)tokens.push('c'+Buffer.from(chars.slice(i,i+n).join('')).toString('hex'));}return [...new Set(tokens)].slice(0,2000);}
function cli(dir,args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(runtime,'openclaw.mjs'),'memory',...args],{env:{PATH:process.env.PATH,HOME:join(dir,'home'),OPENCLAW_STATE_DIR:join(dir,'state'),OPENCLAW_CONFIG_PATH:join(dir,'openclaw.json'),OPENCLAW_NO_RESPAWN:'1',NODE_COMPILE_CACHE:join(root,'code-cache'),NODE_OPTIONS:'--max-old-space-size=256'},detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let out='',err='';const stop=()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};const timer=setTimeout(stop,Math.min(120000,Number(process.env.MEMORY_CORE_CLI_TIMEOUT_MS)||25000));child.stdout.on('data',d=>{out+=d;if(out.length>2e6)stop();});child.stderr.on('data',d=>{err=(err+d).slice(-1000);});child.on('error',reject);child.on('exit',(code,signal)=>{clearTimeout(timer);if(code!==0)reject(Error('INDEX_OPERATION_FAILED_'+(signal??code)));else resolve(out);});});}
async function recall(body){const dir=scopePath(body.scope);if(!body.scope.userId||!Array.isArray(body.records)||body.records.length>100||typeof body.query!=='string'||body.query.length>4000||!Number.isFinite(body.snapshotAt))throw Error('INPUT');
 const invalidatedAt=Math.max(await watermark(body.scope),await watermark({...body.scope,userId:undefined}));
 if(body.snapshotAt<=invalidatedAt||body.snapshotAt>Date.now()+1000)throw Error('STALE_SNAPSHOT');
 const records=body.records.map(r=>{if(!r||!validId(r.id)||typeof r.text!=='string'||r.text.length>1200)throw Error('RECORD');return {id:r.id,text:r.text};}).sort((a,b)=>a.id.localeCompare(b.id));
 const revision=hash(JSON.stringify({schema:2,records}));const marker=join(dir,'revision');let old='';try{old=await readFile(marker,'utf8');}catch{}
 if(old!==revision){await rm(join(dir,'state'),{recursive:true,force:true});await rm(join(dir,'workspace'),{recursive:true,force:true});await mkdir(join(dir,'workspace/memory'),{recursive:true,mode:0o700});await mkdir(join(dir,'home'),{recursive:true,mode:0o700});
  for(const r of records){const target=join(dir,'workspace/memory',r.id+'.md');await writeFile(target,'# Confirmed user memory\n\n'+r.text+'\n\nSearch tokens: '+searchTokens(r.text).join(' ')+'\n',{mode:0o600});}
  const config={gateway:{mode:'local'},agents:{defaults:{workspace:join(dir,'workspace')},entries:{memory:{workspace:join(dir,'workspace')}}},memory:{search:{provider:'none',sources:['memory']}},plugins:{allow:['memory-core'],slots:{memory:'memory-core'}}};
  await writeFile(join(dir,'openclaw.json'),JSON.stringify(config),{mode:0o600});const temp=marker+'.'+randomUUID();await writeFile(temp,revision,{mode:0o600});await rename(temp,marker);for(const key of cache.keys())if(key.startsWith(dir+':'))cache.delete(key);
 }
 if(!records.length)return {ids:[],engine:'memory-core',mode:'keyword'};
 const vocabulary=new Set(records.flatMap(r=>searchTokens(r.text)));
 const query=searchTokens(body.query).filter(term=>vocabulary.has(term)).slice(0,64).join(' ');if(!query)return {ids:[],engine:'memory-core',mode:'keyword'};
 const key=dir+':'+revision+':'+hash(query);if(cache.has(key))return cache.get(key);
 const raw=await cli(dir,['search',query,'--agent','memory','--json','--min-score','0.15','--max-results','5']);const parsed=JSON.parse(raw.slice(raw.indexOf('{')));if(!Array.isArray(parsed.results))throw Error('SEARCH_UNAVAILABLE');const allowed=new Set(records.map(r=>r.id));const ids=[...new Set((parsed.results??[]).map(r=>/^memory\/([a-zA-Z0-9_-]+)\.md$/.exec(r.path)?.[1]).filter(id=>id&&allowed.has(id)))].slice(0,5);
 const result={ids,engine:'memory-core',mode:'keyword'};if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
const server=http.createServer(async(req,res)=>{const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
 if(req.method==='GET'&&req.url==='/health'){send(200,{status:'ready',engine:'memory-core',mode:'keyword',version});return;}
 const provided=(req.headers.authorization??'').replace(/^Bearer /,'');if(Buffer.byteLength(provided)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token))){send(401,{error:'UNAUTHORIZED'});return;}
 if(req.method!=='POST'||!['/recall','/invalidate'].includes(req.url)){send(404,{error:'NOT_FOUND'});return;}
 req.setEncoding('utf8');let raw='',large=false;for await(const data of req){raw+=data;if(Buffer.byteLength(raw)>512000){large=true;break;}}if(large){send(413,{error:'LIMIT'});return;}
 try{const body=JSON.parse(raw);const result=await serial(async()=>{if(req.url==='/recall')return recall(body);const dir=scopePath(body.scope);await mkdir(join(root,'revocations'),{recursive:true,mode:0o700});const mark=watermarkPath(body.scope),temp=mark+'.'+randomUUID();await writeFile(temp,String(Date.now()),{mode:0o600});await rename(temp,mark);await rm(dir,{recursive:true,force:true});for(const key of cache.keys())if(key.startsWith(dir))cache.delete(key);return {invalidated:true};});send(200,result);}catch(error){console.warn('memory_core_request_failed',error.message);send(error.message==='BUSY'?429:503,{error:'MEMORY_CORE_UNAVAILABLE'});}
});
server.listen(Number(process.env.MEMORY_CORE_PORT??18790),process.env.MEMORY_CORE_HOST??'0.0.0.0');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
