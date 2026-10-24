import { Injectable } from '@nestjs/common';
export type MemoryScope = {tenantId:string;appId:string;userId?:string};
@Injectable()
export class MemoryCoreClient {
  get configured(){return Boolean(process.env.MEMORY_CORE_URL&&process.env.MEMORY_CORE_TOKEN);}
  private async call(path:string,body:unknown):Promise<any>{
    if(!this.configured)throw Error('MEMORY_CORE_NOT_CONFIGURED');
    const url=new URL(process.env.MEMORY_CORE_URL!);
    if(url.protocol!=='http:'||!['memory-core','127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw Error('MEMORY_CORE_ENDPOINT_REJECTED');
    const result=await fetch(new URL(path,url),{method:'POST',redirect:'error',headers:{authorization:'Bearer '+process.env.MEMORY_CORE_TOKEN,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(Math.min(120000,Number(process.env.MEMORY_CORE_TIMEOUT_MS)||35000))});
    if(!result.ok)throw Error('MEMORY_CORE_UNAVAILABLE');
    const raw=await result.text();if(raw.length>20000)throw Error('MEMORY_CORE_RESPONSE_LIMIT');return JSON.parse(raw);
  }
  async recall(scope:MemoryScope,records:Array<{id:string;text:string}>,query:string,snapshotAt=Date.now()):Promise<string[]>{const result=await this.call('/recall',{scope,records,query,snapshotAt});if(!Array.isArray(result.ids)||result.ids.length>5||result.ids.some((id:unknown)=>typeof id!=='string'))throw Error('MEMORY_CORE_RESPONSE_REJECTED');const allowed=new Set(records.map(r=>r.id));return result.ids.filter((id:string)=>allowed.has(id));}
  async invalidate(scope:MemoryScope){await this.call('/invalidate',{scope});}
}
