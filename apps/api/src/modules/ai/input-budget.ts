import { ConflictException } from '@nestjs/common';

export function estimatedTokens(text:string){const han=(text.match(/[\p{Script=Han}]/gu)??[]).length;return han+Math.ceil((text.length-han)/4)+8;}

/** Admission estimate, not a provider billing guarantee. Never silently truncate facts. */
export function assertInputBudget(messages:unknown,tools:unknown=[]){
  let imageEstimate=0;
  const safe=Array.isArray(messages)?messages.map(m=>{
    if(!m?.images?.length)return m;
    // Base64 is transport data, not text tokens. Reserve a conservative image
    // allowance; actual provider usage still comes from its receipt.
    imageEstimate+=m.images.length*6000;
    return {...m,images:m.images.map((i:{mime:string})=>({mime:i.mime,data:'[image]'}))};
  }):messages;
  if(imageEstimate+estimatedTokens(JSON.stringify([safe,tools]))>24000)throw new ConflictException('本次AI输入超过用量上限，请缩小业务范围或拆分内容。');
}
