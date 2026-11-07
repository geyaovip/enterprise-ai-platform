const normalized=(text:string)=>text.normalize('NFKC').toLowerCase();
const escapeRegex=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const stop=new Set(['的是','什么','如何','怎么','是否','可以','一下','我们','这个','有关','请问','多少']);
export function queryTerms(query:string):Array<{text:string;weight:number}>{
  const terms=new Map<string,number>();
  const add=(text:string,weight:number)=>terms.set(text,Math.max(weight,terms.get(text)??0));
  const input=normalized(query).replace(/^(?:请问|请帮我|帮我|麻烦|我想知道)\s*/,'');
  for(const part of input.match(/[a-z0-9][a-z0-9_.-]*|[\u3400-\u9fff]+/g)??[]){
    if(/^[a-z0-9]/.test(part)){const token=part.replace(/[.]+$/,'');if(token)add(token,/\d/.test(token)?4:2);}
    else{
      if(part.length>1&&part.length<=12&&!stop.has(part))add(part,2);
      for(let i=0;i<part.length-1;i++){const word=part.slice(i,i+2);if(!stop.has(word))add(word,1);}
    }
  }
  return [...terms].map(([text,weight])=>({text,weight})).sort((a,b)=>b.weight-a.weight).slice(0,32);
}
export const engineeringQuery=(query:string)=>/\b(?:HDMI|USB|UART|MCU|FPGA|ITE|IC|MPN|pin|chip|schematic)\b|芯片|器件|电路|原理图|料号前缀|型号前缀|系列|家族/i.test(query);
export function termPattern(term:string,allowFamily=false){
  // A chip-family stem may have an alphabetic package suffix, never another digit.
  // Delimited business SKUs retain strict boundaries (SKU-1 must not match SKU-10).
  if(allowFamily&&/^[a-z]{2,6}\d{3,8}$/.test(term))return `(^|[^a-z0-9.-])${escapeRegex(term)}([a-z][a-z0-9]*)?($|[^a-z0-9_.-])`;
  if(allowFamily&&/^[a-z]{2,6}\d{3,8}[a-z][a-z0-9]*$/.test(term))return `(^|[^a-z0-9.-])${escapeRegex(term)}($|[^a-z0-9_.-])`;
  return /^[a-z0-9]/.test(term)?`(^|[^a-z0-9_.-])${escapeRegex(term)}($|[^a-z0-9_.-])`:null;
}
export function matchesTerm(text:string,term:string,allowFamily=false){const value=normalized(text),pattern=termPattern(term,allowFamily);return pattern?new RegExp(pattern).test(value):value.includes(term);}
export function queryIdentifiers(query:string){return queryTerms(query).filter(t=>/\d/.test(t.text)&&t.text.length>=3&&!/^\d{4}q[1-4]$/.test(t.text)).map(t=>t.text);}
export type RankedRow={datasetId:string;documentId:string;ordinal:number;text:string;title?:string;locator:Record<string,unknown>;distance:number|null;lexical:number;dimension:number};
export function hybridCandidates(rows:RankedRow[],query:string):RankedRow[]{
  const key=(r:RankedRow)=>`${r.datasetId}:${r.ordinal}`,scores=new Map<string,number>();
  const add=(r:RankedRow,rank:number)=>scores.set(key(r),(scores.get(key(r))??0)+1/(60+rank));
  const identifiers=queryIdentifiers(query);
  const allowed=rows.filter(r=>!identifiers.length||identifiers.some(id=>matchesTerm(r.text+' '+(r.title??''),id,engineeringQuery(query))));
  allowed.filter(r=>r.distance!==null&&r.distance<=0.8).sort((a,b)=>a.distance!-b.distance!||key(a).localeCompare(key(b))).slice(0,32).forEach((r,i)=>add(r,i+1));
  allowed.filter(r=>r.lexical>0).sort((a,b)=>b.lexical-a.lexical||key(a).localeCompare(key(b))).slice(0,32).forEach((r,i)=>add(r,i+1));
  return allowed.filter(r=>scores.has(key(r))).sort((a,b)=>scores.get(key(b))!-scores.get(key(a))!||key(a).localeCompare(key(b))).slice(0,32);
}
/** Deterministic relevance signals; explicitly not a neural reranker. */
export function localRerank<T extends {text:string;title?:string}>(rows:T[],query:string):T[]{
  const terms=queryTerms(query),phrase=normalized(query).trim(),family=engineeringQuery(query);
  const weighted=terms.map(t=>({...t,weight:t.weight*(1+Math.log(1+(rows.length+1)/(1+rows.filter(r=>matchesTerm(r.text,t.text,family)).length)))}));
  const total=weighted.reduce((n,t)=>n+t.weight,0)||1,identifiers=queryIdentifiers(query);
  return rows.map((row,index)=>{
    const text=normalized(row.text),coverage=weighted.reduce((n,t)=>n+(matchesTerm(text,t.text,family)?t.weight:0),0)/total;
    const title=weighted.reduce((n,t)=>n+(matchesTerm(row.title??'',t.text,family)?t.weight:0),0)/total;
    const precise=identifiers.some(t=>matchesTerm(text,t,family))?0.5:0;
    const score=coverage+0.2*title+precise+(phrase.length>1&&text.includes(phrase)?0.3:0)+0.15*(rows.length-index)/Math.max(1,rows.length);
    return {row,index,score};
  }).sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.row);
}
/** Keep a long source's adjacent overlapping chunks from monopolizing the context. */
export function diverseResults<T extends {text:string;documentId:string;ordinal:number}>(rows:T[],limit=8):T[]{
  const selected:T[]=[],deferred:T[]=[],counts=new Map<string,number>();
  for(const row of rows){
    const duplicate=selected.some(x=>x.documentId===row.documentId&&(normalized(x.text)===normalized(row.text)||((x.text.includes(row.text)||row.text.includes(x.text))&&Math.min(x.text.length,row.text.length)>100)));
    if(duplicate)continue;
    if((counts.get(row.documentId)??0)>=2){deferred.push(row);continue;}
    selected.push(row);counts.set(row.documentId,(counts.get(row.documentId)??0)+1);
    if(selected.length===limit)return selected;
  }
  return [...selected,...deferred].slice(0,limit);
}

/** Fill missing engineering identifiers from one adjacent block in the same source page.
 * Context is labeled separately: proximity is evidence, never an asserted electrical relation. */
export function adjacentEvidence<T extends RankedRow>(selected:T[],pool:T[],query:string):T[]{
  const terms=queryTerms(query).filter(t=>/^[a-z][a-z0-9_.-]*\d[a-z0-9_.-]*$/.test(t.text));
  return selected.map(row=>{
    const missing=terms.filter(t=>!matchesTerm(row.text,t.text));
    if(!missing.length)return row;
    const page=JSON.stringify(row.locator.positions),sheet=row.locator.sheet;
    const nearby=pool.filter(x=>x.datasetId===row.datasetId&&Math.abs(x.ordinal-row.ordinal)===1&&
      (page!==undefined?page===JSON.stringify(x.locator.positions):sheet!==undefined&&sheet===x.locator.sheet));
    const best=nearby.map(x=>({x,hits:missing.filter(t=>matchesTerm(x.text,t.text)).length})).filter(x=>x.hits>0).sort((a,b)=>b.hits-a.hits||a.x.ordinal-b.x.ordinal)[0]?.x;
    if(!best||row.text.length+best.text.length>1800)return row;
    return {...row,text:row.text+'\n[同页相邻片段，关联关系须核对]\n'+best.text,locator:{...row.locator,contextSegments:[{ordinal:row.ordinal,locator:row.locator},{ordinal:best.ordinal,locator:best.locator}]}};
  });
}
