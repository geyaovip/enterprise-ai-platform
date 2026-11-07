import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const manual=z.object({id:z.uuid(),filename:z.string().max(160),sha256:z.string().regex(/^[a-f0-9]{64}$/),page:z.int().min(1).max(24).nullable(),sheet:z.string().max(160).nullable(),table:z.int().positive(),row:z.int().positive(),sku:z.string().max(500),name:z.string().max(500),sourceQuantity:z.string().max(100),sourceUnit:z.string().max(100)}).strict();
export const bomReviewSchema=z.object({selectedGroup:z.string().max(1000),groups:z.array(z.object({id:z.string().max(1000),productId:z.uuid().nullable(),productUnit:z.string().max(100).optional(),selectedVariant:z.string().max(500).nullable(),reviewed:z.boolean(),lines:z.array(z.object({key:z.string().max(100),materialId:z.uuid().nullable(),materialUnit:z.string().max(100).optional(),quantity:z.string().max(100).nullable(),excluded:z.boolean(),factReviewed:z.boolean(),reviewNote:z.string().max(500),manual:manual.optional()}).strict()).max(600)}).strict()).max(300)}).strict().refine(v=>v.groups.reduce((n,g)=>n+g.lines.length,0)<=600,'暂存明细过多');
export type BomReview=z.infer<typeof bomReviewSchema>;
const fail=():never=>{throw new BadRequestException('暂存内容与原识别来源不一致，请重新载入原任务');};
const unit=(s:string)=>['pcs','pc','ea','piece','pieces','件','个'].includes(s.toLowerCase())?'piece':s.toLowerCase();

/** Only editable fields are restored; source facts, vision receipts and row order come from the task. */
export function restoreBomReview(base:any,review:BomReview,materials:any[],capture=false){
 const result=structuredClone(base),ids=new Set<string>();let invalidated=false;
 const baseIds=base.groups.map((g:any)=>g.id);
 if(review.groups.length<baseIds.length||baseIds.some((id:string)=>!review.groups.some(g=>g.id===id)))fail();
 const groups=review.groups.map(g=>{
  if(ids.has(g.id))fail();ids.add(g.id);
  const original=base.groups.find((v:any)=>v.id===g.id),keys=new Set<string>();
  if(!original&&(!z.uuid().safeParse(g.id).success||g.lines.some(l=>!l.manual)))fail();
  const product=materials.find(m=>m.id===g.productId&&['finished','semi'].includes(m.kind))??null;
  if(capture&&g.productId&&!product)throw new BadRequestException('父产品已失效，暂存前请重新选择');
  const productChanged=!!g.productId&&(!product||(!capture&&g.productUnit!==product.unit));
  const lines=g.lines.map(l=>{
   if(keys.has(l.key))fail();keys.add(l.key);
   let source:any;
   if(l.manual){
    if(l.key!=='manual:'+l.manual.id)fail();
    const s=base.sources.find((s:any)=>s.filename===l.manual!.filename&&s.sha256===l.manual!.sha256);if(!s)fail();
    source={reviewId:l.manual.id,sku:l.manual.sku,name:l.manual.name,sourceQuantity:l.manual.sourceQuantity,sourceUnit:l.manual.sourceUnit,reviewNote:l.reviewNote,reviewReasons:['人工补录：须核实原件、用量与补录依据'],evidence:'人工补录 · '+s.filename,confidence:0,conflict:true,locator:{...s,filename:s.filename,sha256:s.sha256,page:l.manual.page,sheet:l.manual.sheet,table:l.manual.table,row:l.manual.row,method:'manual-source',...(s.visionJobId?{visionJobId:s.visionJobId,sourceFileId:s.sourceFileId}:{})}};
   }else{
    const index=Number(l.key.replace(/^source:/,''));
    if(l.key!=='source:'+index||!original?.lines[index]||original.lines[index].locator?.method==='manual-source')fail();
    source=structuredClone(original.lines[index]);
   }
   const material=materials.find(m=>m.id===l.materialId)??null;
   if(capture&&l.materialId&&!material)throw new BadRequestException('组件物料已失效，暂存前请重新选择');
   const changed=productChanged||!!l.materialId&&(!material||!capture&&l.materialUnit!==material.unit);
   if(changed)invalidated=true;
   const variant=source.quantities&&Object.keys(source.quantities).length?g.selectedVariant:null;
   const history=source.historyCandidates?.find((h:any)=>h.material.id===material?.id);
   return {...source,material,status:material?'selected':'unmatched',historyMatch:history?.bom,selectedVariant:variant||undefined,sourceQuantity:variant&&Object.hasOwn(source.quantities,variant)?source.quantities[variant]:source.sourceQuantity,unit:material?.unit??source.sourceUnit??'',unitConflict:!!material&&!!source.sourceUnit&&unit(material.unit)!==unit(source.sourceUnit),quantity:changed?null:l.quantity,excluded:source.doNotPopulate||l.excluded,factReviewed:l.factReviewed&&!changed,reviewNote:l.reviewNote||undefined};
  });
  if(original&&original.lines.some((_:any,i:number)=>!keys.has('source:'+i)))fail();
  // Original rows cannot be removed or rearranged by a review document.
  if(original&&g.lines.slice(0,original.lines.length).some((l,i)=>l.key!=='source:'+i))fail();
  return {...(original??{id:g.id,label:g.lines[0]?.manual?.filename+' · 人工核对',productCode:'',parentSku:'',revision:'',uncertainties:['人工补录须逐行核对原件']}),product,productStatus:product?'selected':'unmatched',selectedVariant:g.selectedVariant||undefined,reviewed:g.reviewed&&!productChanged&&!lines.some(l=>!l.excluded&&(l.conflict||l.quantityBasis||l.historyMatch)&&!l.factReviewed),lines};
 });
 if(!ids.has(review.selectedGroup))fail();result.groups=groups;result.selectedGroup=review.selectedGroup;result.totalRows=groups.reduce((n,g)=>n+g.lines.length,0);
 const captured={...review,groups:review.groups.map(g=>({...g,productUnit:materials.find(m=>m.id===g.productId)?.unit,lines:g.lines.map(l=>({...l,materialUnit:materials.find(m=>m.id===l.materialId)?.unit}))}))};
 return {result,invalidated,document:captured};
}
