import { ConflictException } from '@nestjs/common';

export function estimatedTokens(text:string){const han=(text.match(/[\p{Script=Han}]/gu)??[]).length;return han+Math.ceil((text.length-han)/4)+8;}

/** Admission estimate, not a provider billing guarantee. Never silently truncate facts. */
export function assertInputBudget(messages:unknown,tools:unknown=[]){
  if(estimatedTokens(JSON.stringify([messages,tools]))>24000)throw new ConflictException('本次AI输入超过用量上限，请缩小业务范围或拆分内容。');
}
