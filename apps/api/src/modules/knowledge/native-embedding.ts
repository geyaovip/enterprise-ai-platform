import { KnowledgeModelBudget, textTokenReservation } from './knowledge-model-budget';
import { infrastructureEndpoint, infrastructureSecret, type Binding } from '../platform/infrastructure-contract';
import { NativeKnowledgeError } from './native-parser';
import { knowledgeModelsEnabled } from './knowledge-policy';
export class NativeEmbedding {
  readonly model:string;
  private readonly format:string;
  constructor(private readonly binding:Binding){
    const options=binding.options as {embeddingModel?:string;embeddingFormat?:string};
    this.model=options.embeddingModel??'';this.format=options.embeddingFormat??'openai';
    if(!this.model||!['openai','ark-multimodal'].includes(this.format))throw new NativeKnowledgeError('EMBEDDING_CONFIGURATION');
  }
  get enabled(){return knowledgeModelsEnabled();}
  private normalize(vector:unknown):number[]{
    if(!Array.isArray(vector)||!vector.length||vector.length>4000||vector.some(x=>typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>65504))throw new NativeKnowledgeError('EMBEDDING_INVALID');
    const norm=Math.hypot(...vector);if(!Number.isFinite(norm)||!norm)throw new NativeKnowledgeError('EMBEDDING_INVALID');
    return vector.map(x=>x/norm);
  }
  private async request(texts:string[],signal?:AbortSignal,budget?:KnowledgeModelBudget):Promise<number[][]>{
    if(!this.enabled)throw new NativeKnowledgeError('KNOWLEDGE_MODELS_DISABLED');
    try{
      const ark=this.format==='ark-multimodal';
      const dispatch=async()=>{
      const response=await fetch(`${infrastructureEndpoint(this.binding.baseUrl)}/embeddings${ark?'/multimodal':''}`,{method:'POST',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(30_000),...(signal?[signal]:[])]),headers:{authorization:`Bearer ${infrastructureSecret(this.binding.secretCiphertext,true)}`,'content-type':'application/json'},body:JSON.stringify({model:this.model,input:ark?[{type:'text',text:texts[0]}]:texts})});
      if(!response.ok||!response.body)throw new NativeKnowledgeError('EMBEDDING_UNAVAILABLE');
      const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
      try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>2*1024*1024)throw new NativeKnowledgeError('EMBEDDING_INVALID');parts.push(next.value);}}
      finally{await reader.cancel().catch(()=>{});}
      let result:any;try{result=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new NativeKnowledgeError('EMBEDDING_INVALID');}
      return result;
      };
      const result=budget?await budget.run('embedding',this.model,textTokenReservation(texts),0,dispatch):await dispatch();
      if(ark)return [this.normalize(result.data?.embedding??result.data?.[0]?.embedding)];
      if(!Array.isArray(result.data)||result.data.length!==texts.length)throw new NativeKnowledgeError('EMBEDDING_INVALID');
      const vectors:number[][]=new Array(texts.length);
      for(const [position,item]of result.data.entries()){
        const index=item.index??(texts.length===1?position:undefined);
        if(!Number.isInteger(index)||index<0||index>=texts.length||vectors[index])throw new NativeKnowledgeError('EMBEDDING_INVALID');
        vectors[index]=this.normalize(item.embedding);
      }
      if(vectors.some(v=>v.length!==vectors[0].length))throw new NativeKnowledgeError('EMBEDDING_DIMENSION_CHANGED');
      return vectors;
    }catch(error){if(error instanceof NativeKnowledgeError)throw error;throw new NativeKnowledgeError('EMBEDDING_UNAVAILABLE');}
  }
  async embed(text:string,signal?:AbortSignal,budget?:KnowledgeModelBudget){return (await this.request([text],signal,budget))[0];}
  async embedMany(texts:string[],signal?:AbortSignal,budget?:KnowledgeModelBudget):Promise<number[][]>{
    if(!texts.length)return [];
    const batchSize=this.format==='openai'?16:1;
    if(budget){let tokens=0;for(let i=0;i<texts.length;i+=batchSize)tokens+=textTokenReservation(texts.slice(i,i+batchSize));await budget.preflight(Math.ceil(texts.length/batchSize),tokens);}
    const result:number[][]=new Array(texts.length);let cursor=0;
    await Promise.all([0,1].map(async()=>{while(cursor<texts.length){const start=cursor;cursor+=batchSize;if(signal?.aborted)throw new NativeKnowledgeError('EMBEDDING_UNAVAILABLE');const values=await this.request(texts.slice(start,start+batchSize),signal,budget);for(let i=0;i<values.length;i++)result[start+i]=values[i];}}));
    return result;
  }
}
