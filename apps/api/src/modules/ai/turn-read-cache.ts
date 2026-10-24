/** Deliberately per turn, with a fresh authorization/data stamp on every lookup. */
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export class TurnReadCache {
  private readonly entries=new Map<string,unknown>();
  async read(tool:string,input:unknown,stamp:()=>Promise<string>,load:()=>Promise<unknown>){
    const before=await stamp(),key=JSON.stringify([tool,canonical(input),before]);
    if(this.entries.has(key))return {value:this.entries.get(key),reused:true};
    const value=await load();
    if(before===await stamp())this.entries.set(key,value);
    return {value,reused:false};
  }
}
