import { BadRequestException, ConflictException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { z } from 'zod';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { Prisma } from '../../generated/prisma/client';
import { decimal, notPopulated } from './mes.rules';
import { MesService } from './mes.service';
import { compatibleHistory, sameReviewedSource, bomIdentityKey } from './bom-history';
import { bomVisionConfigured } from './bom-vision.provider';

const MAX_BYTES = 8 * 1024 * 1024;
const documentSchema = z.object({filename:z.string().trim().min(1).max(160).regex(/^[^/\\\x00-\x1f]+$/),data:z.string().min(1).max(11184812).regex(/^[A-Za-z0-9+/]+={0,2}$/),productCode:z.string().trim().max(100).optional(),revision:z.string().trim().max(80).optional()}).strict();
const inputSchema = z.object({kind:z.literal('bom'),productId:z.uuid().optional(),source:z.object({text:z.string().max(12000).default(''),documents:z.array(documentSchema).max(6).default([])}).strict()}).strict();
export function validateBomInput(raw:unknown){
  const input=readBody(inputSchema,raw),seen=new Set<string>(),filenames=new Set<string>();let size=0;
  if(!input.source.text.trim()&&!input.source.documents.length)throw new BadRequestException('请选择图纸或物料清单，或粘贴包含表头的明细');
  for(const doc of input.source.documents){
    const name=doc.filename.normalize('NFKC').toLowerCase();if(filenames.has(name)||name==='粘贴资料.tsv')throw new BadRequestException('文件名重复或与粘贴资料重名，请重命名后整理');filenames.add(name);
    const bytes=Buffer.from(doc.data,'base64');size+=bytes.length;
    if(!bytes.length||bytes.toString('base64')!==doc.data||size>MAX_BYTES)throw new BadRequestException('资料合计不能超过8MiB');
    if(!/\.(pdf|png|jpe?g|xls|xlsx|pcbdoc|csv|tsv|txt)$/i.test(doc.filename))throw new BadRequestException('支持PDF、PNG/JPEG、XLS/XLSX、PCB6布局清点、CSV、TSV和TXT；其他原生CAD/EDA请先导出明细表');
    const hash=createHash('sha256').update(bytes).digest('hex');if(seen.has(hash))throw new BadRequestException('资料包含重复文件，请移除重复项后整理');seen.add(hash);
  }
  return input;
}
type CellRow = {visionIdentityConflict?:boolean;quantities?:Record<string,string>;spec?:string;length?:string;comment?:string;value?:string;connector?:string;terminal?:string;unverifiedQuantity?:string;identityHintOnly?:boolean;modelHint?:string;item?:string;sku?:string;name?:string;quantity?:string;unit?:string;parent?:string;level?:string;wastePercent?:string;mpn?:string;manufacturer?:string;designators?:string;population?:string;revision?:string;sourceObjectId?:string;sourceDesignator?:string;sourceUniqueId?:string;sourceHierarchy?:string;footprint?:string;quantityBasis?:'pcb-object-count';sourceRow:number;rawCells:string[];confidence:number;bbox?:number[];reviewReasons?:string[]};
export type BomTable = {origin?:{jobId:string;fileId:string;pageIndex:number};vision?:{jobId:string;fileId:string;pageIndex:number;models:string[];usageIds:string[];promptSha256:string};columnMapping?:Array<{column:number;header:string;field:string}>;file:string;sourceSha256?:string;productCode?:string;revision?:string;verification?:string;warnings?:string[];page?:number;sheet?:string;table:number;method:string;rows:CellRow[];pageSize?:number[]};
export type BomParse = {tables:BomTable[];sources:{filename:string;sha256:string;bytes:number;parseState?:string;warning?:string}[];pageCount:number};
export type BomMaterial = {id:string;sku:string;name:string;unit:string;kind:string};
const clean = (v:string|undefined) => (v??'').normalize('NFKC').trim();
const unitAliases:Record<string,string>={pcs:'piece',pc:'piece',ea:'piece',piece:'piece',pieces:'piece','件':'piece','个':'piece'};
const unitKey = (v:string) => unitAliases[clean(v).toLowerCase()]??clean(v).toLowerCase();

function references(value:string|undefined){
  const output:string[]=[],invalid:string[]=[];
  for(const token of clean(value).toUpperCase().split(/[,，;；\s]+/).filter(Boolean)){
    const range=/^([A-Z]{1,8})(\d+)-([A-Z]{1,8})?(\d+)$/.exec(token);
    if(range&&(!range[3]||range[1]===range[3])&&Number(range[4])>=Number(range[2])&&Number(range[4])-Number(range[2])<300){for(let i=Number(range[2]);i<=Number(range[4]);i++)output.push(range[1]+i);}
    else if(/^[A-Z]{1,8}\d+[A-Z]?$/.test(token))output.push(token);
    else invalid.push(token);
    if(output.length>300)return {values:[],invalid:true};
  }
  return {values:output,invalid:invalid.length>0};
}

export function exactBomQuantity(value:string|undefined): string|null {
  let v=clean(value);
  if (/^\.\d+$/.test(v))v='0'+v;
  const fraction=/^(\d{1,9})\/(\d{1,9})$/.exec(v);
  if(fraction){if(!Number(fraction[2]))return null;const n=new Prisma.Decimal(fraction[1]).div(fraction[2]);if(n.decimalPlaces()>3)return null;v=n.toFixed();}
  if(/^\d{1,9}(?:\.\d{1,12})?$/.test(v))v=new Prisma.Decimal(v).toFixed();
  return decimal.safeParse(v).success?new Prisma.Decimal(v).toFixed():null;
}

/** Resolve only exact source facts; missing/ambiguous rows remain visible and never get a default quantity. */
export function reconcileBomTables(parsed:BomParse,materials:BomMaterial[],selected?:BomMaterial) {
  const groups:any[]=[],uncertainties:string[]=parsed.sources.filter(s=>s.warning).map(s=>`${s.filename}：${s.warning}`);
  const resolve=(sku:string,name:string,production=false)=>{
    const candidates=materials.filter(m=>(!production||['finished','semi'].includes(m.kind))&&(sku?clean(m.sku)===sku:Boolean(name)&&clean(m.name)===name));
    return {material:candidates.length===1?candidates[0]:null,status:candidates.length===1?'matched':candidates.length?'ambiguous':'unmatched'};
  };
  for(const table of parsed.tables){
    const stack=new Map<number,string>();
    for(const row of table.rows){
      const sku=clean(row.sku),name=clean(row.name),mpn=clean(row.mpn),manufacturer=clean(row.manufacturer),revision=clean(row.revision)||clean(table.revision),productCode=clean(table.productCode),reasons=[...(row.reviewReasons??[])];
      // A native component is exactly one layout object. Its label may literally
      // contain a range, which must not be expanded like an exported BOM cell.
      const ref=row.quantityBasis==='pcb-object-count'&&!/^[A-Za-z]{1,8}\d+[A-Za-z]?$/.test(clean(row.designators))?{values:[],invalid:true}:references(row.designators),population=clean(row.population);
      const doNotPopulate=notPopulated(population,row.quantity,mpn);
      if(ref.invalid)reasons.push('位号格式不明确，不能据此推断数量');
      if(new Set(ref.values).size!==ref.values.length)reasons.push('同一行包含重复位号，须核对');
      let parent=clean(row.parent);
      if(row.level!==undefined&&row.level!==''){
        const level=Number(row.level);
        if(!Number.isInteger(level)||level<0||level>10)reasons.push('层级无效，须核对父件');
        else{
          if(level===0){stack.clear();stack.set(0,sku||name);continue;}
          if(!parent)parent=stack.get(level-1)??'';
          if(!parent)reasons.push('父层级缺失，不能合并到其他装配');
          for(const n of stack.keys())if(n>=level)stack.delete(n);
          stack.set(level,sku||name);
        }
      }
      const scope=[table.file,table.sheet??'',parent||`page:${table.page??0}:table:${table.table}`,...(revision?[revision]:[])].join(':');
      let group=groups.find(g=>g.id===scope);
      if(!group){
        const productMatch=parent?resolve(parent,'',true):{material:parsed.tables.length===1?selected??null:null,status:selected&&parsed.tables.length===1?'selected':'unmatched'};
        group={id:scope,label:parent||[table.file,table.sheet,table.page?`第${table.page}页`:null,`表${table.table}`].filter(Boolean).join(' · '),parentSku:parent,productCode:productCode||parent||selected?.sku||'',revision,verification:table.verification,product:productMatch.material,productStatus:productMatch.status,lines:[],uncertainties:[...(table.warnings??[]),...(table.verification==='layout-inventory-only'?['当前为PCB布局对象清点；请逐项核对装配版本、是否贴装及企业物料，不能直接作为已确认采购BOM']:[])]};groups.push(group);
      }
      const match=row.visionIdentityConflict||row.quantityBasis==='pcb-object-count'||(row.identityHintOnly&&!sku)?{material:null,status:'unmatched'}:resolve(sku,name),material=match.material;
      const embedded=/^(\d+(?:\.\d+)?|\d+\/\d+)\s*(件|个|台|套|箱|包|千克|公斤|毫米|米|pcs|pc|ea|kg|mm|cm|g|m)$/i.exec(clean(row.quantity));
      const hasVariants=Boolean(row.quantities&&Object.keys(row.quantities).length);
      const quantity=hasVariants?null:exactBomQuantity(embedded?.[1]??row.quantity);
      const sourceUnit=clean(row.unit)||embedded?.[2]||'',unit=sourceUnit||material?.unit||'';
      const unitConflict=Boolean((material&&sourceUnit&&unitKey(sourceUnit)!==unitKey(material.unit))||(embedded&&row.unit&&unitKey(embedded[2])!==unitKey(row.unit)));
      const zeroQuantity=!hasVariants&&/^0+(?:\.0+)?$/.test(clean(embedded?.[1]??row.quantity));
      if(zeroQuantity)reasons.push('来源数量为0，默认排除；不能默认成1，改量须填写核对依据');
      if(!quantity&&!doNotPopulate&&!zeroQuantity)reasons.push('用量缺失、格式不明确或超过支持精度，请填写明确的单件用量');
      if(doNotPopulate)reasons.push('来源明确标记不装件或不纳入BOM，默认排除，不计入装配用量');
      if(quantity&&ref.values.length&&new Prisma.Decimal(quantity).isInteger()&&!new Prisma.Decimal(quantity).equals(ref.values.length)&&!doNotPopulate)reasons.push('来源数量与位号个数不一致，须核对');
      if(clean(row.revision)&&clean(table.revision)&&clean(row.revision)!==clean(table.revision))reasons.push('行版本与所标资料版本不一致，须核对');
      if(!sku&&!name&&!mpn)reasons.push('组件身份未识别');
      if(match.status==='unmatched')reasons.push('物料未匹配，请从本企业物料中选择');
      if(match.status==='ambiguous')reasons.push('同名物料不唯一，请确认件号');
      if(unitConflict)reasons.push('来源单位与物料单位不一致，须核对换算后的用量');
      if(!sourceUnit&&material)reasons.push('来源未标单位，当前按物料计量单位显示，请核对');
      if(!unit)reasons.push('来源未标计量单位，请核对');
      if(hasVariants)reasons.push('请先选择适用机型，再逐行核对该列用量；空白与0不互换');
      if(!sku&&mpn&&/[;；\n]|\s\/\s/.test(mpn))reasons.push('来源包含多个替代料号，须确认本次采用物料，不拆成多倍需求');
      if(mpn||row.designators)if(!mpn)reasons.push('来源未提供MPN，不能按位号或历史型号猜补');
      if(material&&group.product?.id===material.id)reasons.push('产品不能引用自身');
      const waste=clean(row.wastePercent).replace(/%$/,''),validWaste=/^\d{1,2}(?:\.\d{1,2})?$/.test(waste);
      if(waste&&!validWaste)reasons.push('损耗率不明确，请核对');
      const locator={filename:table.file,sha256:table.sourceSha256??null,page:table.page??null,sheet:table.sheet??null,table:table.table,row:row.sourceRow,bbox:row.bbox??null,pageSize:table.pageSize??null,method:table.method,...((table.origin??table.vision)?{visionJobId:(table.origin??table.vision)!.jobId,sourceFileId:(table.origin??table.vision)!.fileId,pageIndex:(table.origin??table.vision)!.pageIndex}:{}),...(row.sourceObjectId?{sourceObjectId:row.sourceObjectId,stream:'Components6/Data + Texts6/Data',verification:'layout-inventory-only'}:{})};
      group.lines.push({sourceItem:row.item,sku,name:name||material?.name||sku||mpn,quantities:row.quantities,spec:row.spec,length:row.length,comment:row.comment,value:row.value,connector:row.connector,terminal:row.terminal,columnMapping:table.columnMapping,vision:table.vision,modelHint:row.modelHint,identityHintOnly:row.identityHintOnly,mpn,manufacturer,designators:ref.values,sourceDesignators:row.designators??'',population,doNotPopulate,excluded:doNotPopulate||zeroQuantity,revision,productCode,sourceObjectId:row.sourceObjectId,sourceDesignator:row.sourceDesignator,sourceUniqueId:row.sourceUniqueId,sourceHierarchy:row.sourceHierarchy,footprint:row.footprint,quantityBasis:row.quantityBasis,conflict:Boolean(table.vision)||hasVariants||!sourceUnit||Boolean(reasons.length)||table.method==='ocr-cells'||unitConflict||row.quantityBasis==='pcb-object-count'||ref.invalid,material,status:match.status,quantity:doNotPopulate||unitConflict?null:quantity,sourceQuantity:row.unverifiedQuantity??row.quantity??'',unit,sourceUnit,unitConflict,wastePercent:validWaste?waste:null,parent,reviewReasons:[...new Set(reasons)],confidence:row.confidence,locator,evidence:[table.file,revision?`版本 ${revision}`:null,table.page?`第${table.page}页`:table.sheet,`表${table.table}第${row.sourceRow}行`,row.rawCells.join(' | ')].filter(Boolean).join(' · ').slice(0,1000),sourceCells:row.rawCells});
    }
  }
  for(const group of groups){
    const refOwners=new Map<string,any>();
    for(const line of group.lines)for(const ref of line.designators){const prior=refOwners.get(ref);if(prior){for(const l of [prior,line]){l.conflict=true;l.reviewReasons.push(`位号 ${ref} 被多行重复使用，不能重复计量`);}}else refOwners.set(ref,line);}
    const seen=new Map<string,any[]>();
    for(const line of group.lines){const identity=line.material?.id||line.sku||line.name;if(!identity)continue;const list=seen.get(identity)??[];list.push(line);seen.set(identity,list);}
    for(const lines of seen.values())if(lines.length>1)for(const line of lines){line.duplicate=true;line.reviewReasons.push(new Set(lines.map((l:any)=>l.sourceQuantity)).size>1?'相同父件的重复组件用量冲突，不能自动相加':'相同父件存在重复组件，请核对重复页或重复行');}
    if(group.lines.length>200)group.uncertainties.push('该装配超过200行，请分层整理');
    if(!group.product)group.uncertainties.push('父产品未匹配，请选择对应的成品或半成品');
  }
  const comparisons=new Map<string,Array<{group:any;line:any}>>();
  for(const group of groups)if(group.productCode)for(const line of group.lines){const id=line.sku||line.mpn;if(!id)continue;const key=JSON.stringify([group.productCode,group.parentSku,id]);const entries=comparisons.get(key)??[];entries.push({group,line});comparisons.set(key,entries);}
  for(const entries of comparisons.values())if(new Set(entries.map(x=>x.group.id)).size>1&&new Set(entries.map(x=>JSON.stringify([exactBomQuantity(x.line.sourceQuantity)??x.line.sourceQuantity,x.line.mpn,x.line.doNotPopulate]))).size>1){
    const versions=[...new Set(entries.map(x=>x.group.revision||'未标版本'))].join(' / ');
    for(const {group,line}of entries){line.conflict=true;line.reviewReasons.push(`同一产品的多份资料存在用量、MPN或装配状态差异（${versions}），须选择适用版本，不能自动合并`);if(!group.uncertainties.includes('存在多来源差异，请先选择适用版本'))group.uncertainties.push('存在多来源差异，请先选择适用版本');}
  }
  // A multi-assembly import is a graph. Flag cycles before allowing any branch to be adopted.
  const edges=new Map<string,string[]>();for(const g of groups)if(g.parentSku)edges.set(g.parentSku,g.lines.map((l:any)=>l.sku).filter(Boolean));
  const state=new Map<string,number>(),depths=new Map<string,number>(),invalid=new Set<string>();
  const visit=(node:string):number=>{
    if(state.get(node)===1){invalid.add(node);return 11;}
    if(state.get(node)===2)return depths.get(node)??0;
    state.set(node,1);let depth=0;
    for(const next of edges.get(node)??[])depth=Math.max(depth,1+visit(next));
    if(depth>10)invalid.add(node);state.set(node,2);depths.set(node,depth);return depth;
  };
  for(const node of edges.keys())visit(node);
  for(const g of groups)if(invalid.has(g.parentSku)){g.cycle=true;g.uncertainties.push('来源装配关系存在循环或超过10级，须先修正');}
  if(!groups.length)uncertainties.unshift('未找到包含明确件号或名称及用量列的物料明细表；零件加工图不能据外形推断完整BOM，请补充装配明细或物料清单');
  return {kind:'bom',groups,selectedGroup:groups[0]?.id??'',sources:parsed.sources,pageCount:parsed.pageCount,totalRows:groups.reduce((n,g)=>n+g.lines.length,0),uncertainties,requiresReview:true,method:'local-tables'};
}

export function parseDocuments(source:unknown):Promise<BomParse>;
export function parseDocuments(source:unknown,preview:true):Promise<any>;
export function parseDocuments(source:unknown,preview=false):Promise<any>{
  return new Promise((resolve,reject)=>{
    const detached=process.platform!=='win32';
    const child=spawn(process.env.KNOWLEDGE_PYTHON_PATH??'python3',[join(__dirname,preview?'bom-page-preview.py':'bom-document-parser.py')],{detached,stdio:['pipe','pipe','pipe'],env:{...process.env,OMP_THREAD_LIMIT:'1'}});
    let output=Buffer.alloc(0),stderr='',settled=false,killing:ReturnType<typeof setTimeout>|undefined;
    const stop=(signal:NodeJS.Signals)=>{try{if(detached&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{/* Process already exited. */}};
    const finish=(error?:Error,value?:BomParse)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value!);};
    const timer=setTimeout(()=>{stop('SIGTERM');killing=setTimeout(()=>stop('SIGKILL'),1000);killing.unref();finish(new ServiceUnavailableException('资料处理超时，请按装配或明细表分批整理'));},preview?25_000:120_000);
    child.stdout.on('data',(data:Buffer)=>{output=Buffer.concat([output,data]);if(output.length>(preview?12:4)*1024*1024){stop('SIGTERM');finish(new BadRequestException('明细内容过多，请分批整理'));}});
    child.stderr.on('data',(data:Buffer)=>{if(stderr.length<1000)stderr+=data.toString();});
    child.on('error',()=>finish(new ServiceUnavailableException('本地文档识别组件暂不可用')));
    child.stdin.on('error',()=>{});
    child.on('close',(code,signal)=>{
      clearTimeout(killing);
      if(code!==0||signal){const limits:Record<string,string>={DOCUMENT_TIMEOUT:'资料处理超时，请按装配分批整理',DOCUMENT_PAGE_LIMIT:'PDF合计最多24页，请按装配分批整理',DOCUMENT_ROW_LIMIT:'资料明细超过300行，请按装配分批整理',IMAGE_TOO_LARGE:'图片超过1200万像素，请裁剪明细区域',DOCUMENT_TOO_LARGE:'资料内容过多，请分批整理'};finish(new BadRequestException(limits[stderr.trim()]??'文档未能完整读取，请检查文件是否损坏、加密或格式不受支持'));return;}
      try{const value=JSON.parse(output.toString());if(preview?typeof value.data!=='string'||value.mime!=='image/png':!Array.isArray(value.tables)||!Array.isArray(value.sources))throw Error();finish(undefined,value);}catch{finish(new ServiceUnavailableException('资料识别结果不完整，请重试'));}
    });
    child.stdin.end(JSON.stringify(source));
  });
}

@Injectable()
export class MesBomIntakeService {
  private readonly running=new Set<string>();
  constructor(private readonly mes:MesService){}
  private async guard(ctx:RequestContext){for(const p of ['mes.bom.write','mes.material.read'])await this.mes.guard(ctx,p);}
  private async historicalCandidates(ctx:RequestContext,result:any,selected?:BomMaterial){
    if(!selected)return;
    const lines=result.groups.filter((g:any)=>g.product?.id===selected.id&&g.productCode===selected.sku).flatMap((g:any)=>g.lines).filter((l:any)=>!l.material&&!l.doNotPopulate&&((l.mpn&&l.manufacturer)||l.sku&&l.locator?.sha256));
    if(!lines.length)return;
    // Preview can remain available without history-read permission. Do not reveal
    // even a candidate if this permission is revoked before the result returns.
    try{await this.mes.guard(ctx,'mes.bom.read');}catch(e){if(e instanceof HttpException&&e.getStatus()===403)return;throw e;}
    const boms=await this.mes.db.mesBom.findMany({where:{tenantId:ctx.tenantId,productId:selected.id,status:'published'},orderBy:[{revision:'desc'},{id:'asc'}],take:2,select:{id:true,revision:true,version:true,lines:true}});
    const prior=boms.flatMap(b=>Array.isArray(b.lines)?b.lines.slice(0,200).filter((l:any)=>l&&typeof l==='object'&&!Array.isArray(l)).map(l=>({bom:b,line:l as any})):[]);
    const ids=[...new Set(prior.map(x=>x.line.materialId).filter(x=>typeof x==='string'))] as string[];
    if(!ids.length)return;
    const materials=await this.mes.db.mesMaterial.findMany({where:{tenantId:ctx.tenantId,active:true,id:{in:ids}},select:{id:true,sku:true,name:true,unit:true,kind:true}});
    const candidates=lines.map((line:any)=>{
      const seen=new Set<string>();
      const values=prior.filter(p=>compatibleHistory({...line,...line.locator,originalSku:line.sku,originalUnit:line.sourceUnit},p.line)).flatMap(p=>{
        const material=materials.find(m=>m.id===p.line.materialId);
        if(!material||material.id===selected.id||seen.has(material.id))return[];
        seen.add(material.id);
        return [{material,bom:{bomId:p.bom.id,revision:p.bom.revision,version:p.bom.version},basis:[sameReviewedSource({...line,...line.locator,originalSku:line.sku,originalUnit:line.sourceUnit},p.line)?'同一原件、同一来源行的已发布BOM人工核对记录':'本次MPN和制造商与已发布BOM来源一致',bomIdentityKey(line.footprint)&&bomIdentityKey(p.line.sourceEvidence?.footprint)?'封装一致':'封装依据不完整，须核对',bomIdentityKey(line.revision)&&bomIdentityKey(p.line.sourceEvidence?.revision)?'资料版次一致':'资料版次未完整提供，须核对']}];
      });
      return {line,values:values.slice(0,3),truncated:values.length>3};
    });
    try{await this.mes.guard(ctx,'mes.bom.read');}catch(e){if(e instanceof HttpException&&e.getStatus()===403)return;throw e;}
    for(const {line,values,truncated}of candidates)if(values.length){line.historyCandidates=values;line.historyCandidatesTruncated=truncated;}
  }
  async pagePreview(ctx:RequestContext,raw:unknown){
    await this.guard(ctx);
    const input=readBody(z.object({document:documentSchema,page:z.int().min(1).max(24)}).strict(),raw);
    const bytes=Buffer.from(input.document.data,'base64');
    if(!/\.pdf$/i.test(input.document.filename)||!bytes.length||bytes.length>MAX_BYTES||bytes.toString('base64')!==input.document.data||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new BadRequestException('请选择有效PDF原件，最大8MiB');
    const key=ctx.tenantId+':'+ctx.membershipId;
    if(this.running.has(key))throw new ConflictException('资料正在处理，请等待完成');
    if(this.running.size>=2)throw new ServiceUnavailableException('资料处理繁忙，请稍后重试');
    this.running.add(key);
    try{const result=await parseDocuments(input,true);await this.guard(ctx);return result;}finally{this.running.delete(key);}
  }
  async fromParsed(ctx:RequestContext,parsed:BomParse,productId?:string){
      await this.guard(ctx);
      const rows=parsed.tables.flatMap(t=>t.rows);
      const skus=[...new Set(rows.flatMap(r=>[clean(r.sku),clean(r.parent)]).filter(Boolean))],names=[...new Set(rows.map(r=>clean(r.name)).filter(Boolean))];
      const materials=await this.mes.db.mesMaterial.findMany({where:{tenantId:ctx.tenantId,active:true,OR:[{sku:{in:skus}},{name:{in:names}},...(productId?[{id:productId}]:[])]},select:{id:true,sku:true,name:true,unit:true,kind:true}});
      const selected=materials.find(m=>m.id===productId&&['finished','semi'].includes(m.kind));
      if(productId&&!selected)throw new BadRequestException('当前产品不存在、已停用或不属于本企业');
      await this.guard(ctx);const result=reconcileBomTables(parsed,materials,selected);
      await this.historicalCandidates(ctx,result,selected);await this.guard(ctx);return result;
  }
  async options(ctx:RequestContext){await this.guard(ctx);return {enabled:true,local:true,maxFiles:6,maxBytes:MAX_BYTES,maxImagePixels:12_000_000,maxPages:24,visionEnabled:bomVisionConfigured()&&ctx.permissions.includes('mes.ai.use'),formats:['pdf','png','jpg','jpeg','xls','xlsx','pcbdoc','csv','tsv','txt']};}
  async intake(ctx:RequestContext,raw:unknown){
    await this.guard(ctx);
    const input=validateBomInput(raw);
    const key=ctx.tenantId+':'+ctx.membershipId;
    if(this.running.has(key))throw new ConflictException('已有BOM资料正在整理，请等待完成');
    if(this.running.size>=2)throw new ServiceUnavailableException('资料识别繁忙，请稍后重试');
    this.running.add(key);
    try{
      const parsed=await parseDocuments(input.source);await this.guard(ctx);
      return this.fromParsed(ctx,parsed,input.productId);
    }finally{this.running.delete(key);}
  }
}
