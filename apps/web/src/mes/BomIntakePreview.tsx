import { ChoiceSelect } from '../components';
import { useRef, useState } from 'react';
import { Field, Notice } from '../components';
import { BomSourceReview } from './BomSourceReview';
import type { DocumentSource } from '../components/AiIntakePanel';
import { IntakeWarnings } from '../components/AiIntakePanel';
import { Picker, useMes } from './common';

export const selectedBomGroup=(r:any)=>r.groups?.find((g:any)=>g.id===r.selectedGroup);
export const bomSourceFacts=(line:any)=>Object.fromEntries(['vision','sourceItem','spec','length','comment','value','connector','terminal','quantities','selectedVariant','columnMapping'].filter(k=>line[k]!==undefined).map(k=>[k,line[k]]));
const variantReady=(l:any)=>{
  if(!l.quantities||!Object.keys(l.quantities).length)return !/^0+(?:\.0+)?$/.test((l.sourceQuantity??'').trim())||Boolean(l.factReviewed&&l.reviewNote?.trim().length>=4);
  if(!l.selectedVariant||!Object.hasOwn(l.quantities,l.selectedVariant))return false;
  const raw=l.quantities[l.selectedVariant].trim();
  if(/^(?:0+(?:\.0+)?)$/.test(raw))return false;
  return /^\d+(?:\.\d+)?$/.test(raw)&&Number(raw)===Number(l.quantity)||l.reviewNote?.trim().length>=4;
};
export function chooseBomVariant(group:any,variant:string){
  return {...group,selectedVariant:variant,reviewed:false,lines:group.lines.map((l:any)=>{
    if(!l.quantities||!Object.keys(l.quantities).length)return {...l,factReviewed:false};
    const raw=Object.hasOwn(l.quantities,variant)?l.quantities[variant]:'';
    const numeric=/^\d{1,9}(?:\.\d{1,3})?$/.test(raw.trim());
    const reasons=(l.reviewReasons??[]).filter((s:string)=>!s.startsWith('所选机型'));
    if(variant&&numeric&&Number(raw)===0)reasons.push('所选机型数量为0，此行应排除');
    else if(variant&&!numeric)reasons.push('所选机型用量空白或格式不明，请补原资料并核对，不能默认1');
    return {...l,selectedVariant:variant||undefined,sourceQuantity:raw,quantity:numeric&&Number(raw)>0&&!l.unitConflict&&!l.doNotPopulate?raw.trim():null,excluded:l.doNotPopulate||numeric&&Number(raw)===0,conflict:true,factReviewed:false,reviewReasons:reasons,historyCandidates:[],historyMatch:undefined,...(l.historyMatch?{material:null,status:'unmatched'}:{})};
  })};
}
export function chooseBomMaterial(line:any,material:any,historyMatch?:any){
  const key=(value:string)=>{const v=value.normalize('NFKC').trim().toLowerCase();return ['pcs','pc','ea','piece','pieces','件','个'].includes(v)?'piece':v;};
  const unitConflict=Boolean(material&&line.sourceUnit&&key(line.sourceUnit)!==key(material.unit));
  const reasons=(line.reviewReasons??[]).filter((v:string)=>!v.startsWith('所选物料与来源单位不同')&&!v.startsWith('来源未标单位，须核对当前物料')&&(!material||!['物料未匹配，请从本企业物料中选择','同名物料不唯一，请确认件号'].includes(v)));
  if(unitConflict)reasons.push('所选物料与来源单位不同，请填写换算后用量并核实');
  if(material&&!line.sourceUnit)reasons.push('来源未标单位，须核对当前物料单位与用量');
  return {...line,material:material??null,unit:material?.unit??'',unitConflict,quantity:unitConflict?null:line.quantity,status:material?(historyMatch?'history-selected':'selected'):'unmatched',historyMatch,conflict:line.conflict||unitConflict||Boolean(historyMatch)||Boolean(material&&!line.sourceUnit),reviewReasons:reasons,factReviewed:false};
}
export function canAdoptBom(r:any,currentProductId?:string){
  const g=selectedBomGroup(r),lines=g?.lines.filter((l:any)=>!l.excluded)??[];
  return Boolean(g&&!g.cycle&&g.product&&(!currentProductId||g.product.id===currentProductId)&&g.reviewed&&lines.length&&lines.length<=200&&lines.every((l:any)=>!l.doNotPopulate&&variantReady(l)&&((!l.conflict&&!l.quantityBasis&&!l.historyMatch)||l.factReviewed)&&(l.locator?.method!=='manual-source'||Boolean(l.locator.sha256&&Number.isInteger(l.locator.row)&&l.locator.row>0&&(l.locator.page===null||Number.isInteger(l.locator.page)&&l.locator.page>=1&&l.locator.page<=24)&&l.sku?.trim()&&l.reviewNote?.trim().length>=4))&&(!l.reviewNote||l.reviewNote.trim().length>=4)&&l.material&&l.material.id!==g.product.id&&/^\d{1,9}(?:\.\d{1,3})?$/.test(l.quantity??'')&&Number(l.quantity)>0)&&new Set(lines.map((l:any)=>l.material.id)).size===lines.length);
}

function PreviewLine({line,index,change,locate,active,reviewKey}:{line:any;index:number;change:(v:any)=>void;locate:()=>void;active:boolean;reviewKey:string}){
  const [editing,setEditing]=useState(false);const context=useMes();
  return <div data-review-key={reviewKey} className={"ai-intake-row"+(active?" bom-review-active":"")}>
    <label className="check"><input type="checkbox" disabled={line.doNotPopulate} checked={!line.excluded} onChange={e=>change({...line,excluded:!e.target.checked,factReviewed:false})}/>组件 {index+1} · {line.sku||line.name||'待确认'}{line.doNotPopulate?' · 不装件':''}</label>
    <button type="button" aria-pressed={active} onClick={locate}>定位原图</button>{line.sourceItem&&<span>原表序号：{line.sourceItem}</span>}
    {line.locator?.method==='manual-source'&&<><Field label={`组件${index+1}原件件号或名称`}><input maxLength={500} value={line.sku} onChange={e=>change({...line,sku:e.target.value,name:e.target.value,factReviewed:false})}/></Field>{line.locator.page!==null&&line.locator.page!==undefined&&<Field label={`组件${index+1}原件页码`}><input type="number" min={1} max={24} value={line.locator.page} onChange={e=>change({...line,locator:{...line.locator,page:Number(e.target.value)},factReviewed:false})}/></Field>}{/\.xlsx?$/i.test(line.locator.filename)&&<Field label={`组件${index+1}原件工作表`}><input maxLength={160} value={line.locator.sheet??''} onChange={e=>change({...line,locator:{...line.locator,sheet:e.target.value||null},factReviewed:false})}/></Field>}<Field label={`组件${index+1}原件行号`}><input type="number" min={1} value={line.locator.row} onChange={e=>change({...line,locator:{...line.locator,row:Number(e.target.value)},factReviewed:false})}/></Field><Field label={`组件${index+1}补录依据`}><textarea minLength={4} maxLength={500} value={line.reviewNote??''} onChange={e=>change({...line,reviewNote:e.target.value,factReviewed:false})}/></Field></>}
    <p>{line.material?`${line.material.sku} · ${line.material.name}`:'物料待匹配'} · {line.unit||'单位待核对'}</p>
    {(line.mpn||line.sourceDesignators||line.designators?.length||line.revision)&&<p>{[line.mpn?`MPN：${line.mpn}`:null,line.manufacturer,line.sourceDesignators?`原始位号：${line.sourceDesignators}`:line.designators?.length?`位号：${line.designators.join(', ')}`:null,line.revision?`版本：${line.revision}`:null].filter(Boolean).join(' · ')}</p>}
    {(line.spec||line.length||line.connector||line.terminal||line.comment||line.value)&&<p>{[['规格',line.spec],['长度',line.length],['连接器',line.connector],['端子',line.terminal],['注释',line.comment],['标称值',line.value]].filter(([,v])=>v).map(([k,v])=>`${k}：${v}`).join(' · ')}</p>}
    {line.quantities&&Object.keys(line.quantities).length>0&&<p>机型原数量：{Object.entries(line.quantities).map(([k,v])=>`${k}：${v===''?'空白':v}`).join('；')}。{line.selectedVariant?`当前选择：${line.selectedVariant}`:'尚未选择机型'}</p>}
    {!line.quantityBasis&&(line.footprint||line.modelHint&&line.modelHint!==line.name)&&<p>{[line.footprint?`封装：${line.footprint}`:null,line.modelHint&&line.modelHint!==line.name?`标称值/注释：${line.modelHint}`:null].filter(Boolean).join(' · ')}</p>}
    {line.quantityBasis==='pcb-object-count'&&<p>数量依据：板上器件对象计数，装配用量须核对。封装：{line.footprint||'未提供'}{line.sourceDesignator?`；来源位号：${line.sourceDesignator}`:''}</p>}
    {!line.excluded&&<><div className="form-actions"><Field label={`组件${index+1}单件用量`}><input inputMode="decimal" value={line.quantity??''} placeholder="待核对" onChange={e=>change({...line,quantity:e.target.value,...(line.locator?.method==='manual-source'?{sourceQuantity:e.target.value}:{}),factReviewed:false})}/></Field><button type="button" onClick={()=>setEditing(!editing)}>{editing?'收起物料选择':'选择物料'}</button></div>
      {editing&&<Picker label={`组件${index+1}物料`} type="materials" value={line.material?.id??''} selectedLabel={line.material?.name} onChange={m=>change(chooseBomMaterial(line,m))}/>}
      {line.historyCandidates?.length>0&&<details><summary>历史物料参考（{line.historyCandidates.length}项）</summary><p>依据明确MPN和制造商，或同一原件同一行的已审核记录提供参考。用量、贴装状态及版本仍须按本次资料核对。</p>{line.historyCandidates.map((candidate:any)=><div key={candidate.material.id}><p>{candidate.material.sku} · {candidate.material.name} · 已发布BOM v{candidate.bom.revision}</p>{context&&<a href={context.prefix+'/boms/'+candidate.bom.bomId} target="_blank" rel="noreferrer">查看历史BOM</a>}<IntakeWarnings items={candidate.basis}/><button type="button" onClick={()=>change(chooseBomMaterial(line,candidate.material,candidate.bom))}>选用历史物料 {candidate.material.sku}</button></div>)}{line.historyCandidatesTruncated&&<p>仅显示前三项，请进一步核对规格后选料。</p>}</details>}
      {line.historyMatch&&<p>已选历史物料参考，须核实本次适用性；没有复制历史用量。</p>}
      <IntakeWarnings items={line.reviewReasons??[]}/>
      {(line.conflict||line.quantityBasis||line.historyMatch)&&<label className="check"><input type="checkbox" checked={Boolean(line.factReviewed)} onChange={e=>change({...line,factReviewed:e.target.checked})}/>已对照原资料核实本行物料、用量及适用版本</label>}
    </>}
    <details><summary>来源依据</summary>{line.locator?.method!=='manual-source'&&<Field label={`组件${index+1}核对说明（机型补量或来源0改量必填，至少4字）`}><textarea minLength={4} maxLength={500} value={line.reviewNote??''} onChange={e=>change({...line,reviewNote:e.target.value||undefined,factReviewed:false})}/></Field>}<p>{line.evidence}</p>{line.columnMapping?.length>0&&<ul>{line.columnMapping.map((m:any)=><li key={m.column}>第{m.column}列 · {m.header} → {m.field}</li>)}</ul>}{line.locator?.bbox&&<small>原图位置：{line.locator.bbox.map((x:number)=>Math.round(x)).join(', ')}；图幅 {line.locator.pageSize?.join(' × ')}</small>}</details>
  </div>;
}

export function BomIntakePreview({result,update,currentProductId,documents=[]}:{result:any;update:(v:any)=>void;currentProductId?:string;documents?:DocumentSource[]}){
  const [selected,setSelected]=useState<string|null>(null),[pendingOnly,setPendingOnly]=useState(false),[manualSource,setManualSource]=useState('');const context=useMes(),workspace=useRef<HTMLDivElement|null>(null);
  const group=selectedBomGroup(result);
  const changeGroup=(value:any)=>update({...result,groups:result.groups.map((g:any)=>g.id===value.id?value:g)});
  const pending=(l:any)=>!l.excluded&&(!variantReady(l)||!l.material||!/^\d{1,9}(?:\.\d{1,3})?$/.test(l.quantity??'')||Number(l.quantity)<=0||((l.conflict||l.quantityBasis||l.historyMatch)&&!l.factReviewed));
  const activeLine=group?.lines.find((l:any,n:number)=>(group.id+':'+(l.reviewId??n))===selected);
  const locate=(key:string)=>{setSelected(key);if(matchMedia('(max-width:1000px)').matches)requestAnimationFrame(()=>workspace.current?.querySelector<HTMLElement>('.bom-source-review')?.scrollIntoView({block:'start',behavior:'smooth'}));};
  const returnToLine=()=>{const row=Array.from(workspace.current?.querySelectorAll<HTMLElement>('[data-review-key]')??[]).find(el=>el.dataset.reviewKey===selected);row?.scrollIntoView({block:'start',behavior:'smooth'});row?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});};
  const appendLine=()=>{
    const origin=group?.lines[0]?.locator,source=result.sources.find((s:any)=>s.filename===origin?.filename);
    if(!group||!source)return;
    const reviewId=crypto.randomUUID();
    changeGroup({...group,reviewed:false,lines:[...group.lines,{reviewId,sku:'',name:'',sourceQuantity:'',quantity:null,unit:'',sourceUnit:'',status:'unmatched',material:null,conflict:true,factReviewed:false,reviewNote:'',confidence:0,reviewReasons:['人工补录：须填写原件件号或名称、补录依据，并核实用量'],evidence:'人工补录 · '+source.filename,locator:{...origin,filename:source.filename,sha256:source.sha256,row:group.lines.length+1,method:'manual-source',bbox:undefined,pageSize:undefined}}]});setSelected(group.id+':'+reviewId);setPendingOnly(false);requestAnimationFrame(()=>{const row=workspace.current?.querySelector<HTMLElement>('.ai-intake-row:last-child');row?.scrollIntoView({block:'start',behavior:'smooth'});row?.querySelector<HTMLInputElement>('input[maxlength]')?.focus({preventScroll:true});});
  };
  const changeLine=(index:number,line:any)=>changeGroup({...group,reviewed:false,lines:group.lines.map((l:any,n:number)=>n===index?line:l)});
  const manualCandidates=result.sources.filter((s:any)=>!result.groups.some((g:any)=>g.lines.some((l:any)=>l.locator?.filename===s.filename&&l.locator.method==='manual-source'))&&(s.parseState?.endsWith('review-required')||!result.groups.some((g:any)=>g.lines.some((l:any)=>l.locator?.filename===s.filename))));
  const startManual=()=>{
    const s=manualCandidates.find((s:any)=>s.filename===manualSource)??manualCandidates[0];if(!s)return;
    const id=crypto.randomUUID(),reviewId=crypto.randomUUID();
    const g={id,label:s.filename+' · 人工核对',product:null,productCode:'',parentSku:'',revision:'',reviewed:false,uncertainties:['未确认物料表，请依据原件补录并逐行核实，不能从外形猜测组件'],lines:[{reviewId,sku:'',name:'',sourceQuantity:'',quantity:null,unit:'',sourceUnit:'',material:null,status:'unmatched',conflict:true,factReviewed:false,reviewNote:'',reviewReasons:['请填写原件件号或名称、明确用量和补录依据'],evidence:'人工补录 · '+s.filename,confidence:0,locator:{...(s.visionJobId?{visionJobId:s.visionJobId,sourceFileId:s.sourceFileId}:{}),filename:s.filename,sha256:s.sha256,page:/\.pdf$/i.test(s.filename)?1:null,sheet:null,table:1,row:1,method:'manual-source'}}]};
    update({...result,groups:[...result.groups,g],selectedGroup:id});setPendingOnly(false);setSelected(id+':'+reviewId);
  };
  return <>
    <p>共读取 {result.sources.length} 份资料，当前 {result.groups.length} 个核对分组、{result.groups.reduce((n:number,g:any)=>n+g.lines.length,0)} 行候选明细。</p>
    <IntakeWarnings items={result.uncertainties}/>
    {manualCandidates.length>0&&<div className="form-actions"><ChoiceSelect label="需人工核对的资料" value={manualCandidates.some((s:any)=>s.filename===manualSource)?manualSource:manualCandidates[0].filename} onChange={e=>setManualSource(e.target.value)}>{manualCandidates.map((s:any)=><option key={s.filename} value={s.filename}>{s.filename}</option>)}</ChoiceSelect><button type="button" onClick={startManual}>按原件手工补录</button></div>}
    {group&&<>
      {result.groups.length>1&&<ChoiceSelect label="本次填入的装配" value={group.id} onChange={e=>update({...result,selectedGroup:e.target.value})}>{result.groups.map((g:any)=><option key={g.id} value={g.id}>{g.label}{g.revision?` · 版本 ${g.revision}`:''} · {g.lines.length}行</option>)}</ChoiceSelect>}
      <p>{[...new Set([group.label,group.productCode,group.revision?`版本 ${group.revision}`:null].filter(Boolean))].join(' · ')}</p>
      <Picker label="父产品" type="materials" kind="production" value={group.product?.id??''} selectedLabel={group.product?.name} onChange={m=>changeGroup({...group,reviewed:false,product:m??null,lines:group.lines.map((l:any)=>({...l,historyCandidates:[],historyMatch:undefined,factReviewed:false,...(l.historyMatch?{material:null,status:'unmatched'}:{})}))})}/>
      <Notice text={currentProductId&&group.product?.id!==currentProductId?'父产品与当前BOM不一致，不能替换':null}/>
      <IntakeWarnings items={group.uncertainties}/>
      {group.lines.some((l:any)=>l.quantities&&Object.keys(l.quantities).length>0)&&<ChoiceSelect label="适用机型数量列" value={group.selectedVariant??''} onChange={e=>changeGroup(chooseBomVariant(group,e.target.value))}><option value="">请选择机型</option>{[...new Set<string>(group.lines.flatMap((l:any)=>Object.keys(l.quantities??{})))].map(v=><option key={v} value={v}>{v}</option>)}</ChoiceSelect>}
      <div className="form-actions"><p aria-live="polite">待处理 {group.lines.filter(pending).length} 行 · 已排除 {group.lines.filter((l:any)=>l.excluded).length} 行</p><label className="check"><input type="checkbox" checked={pendingOnly} onChange={e=>setPendingOnly(e.target.checked)}/>仅显示待处理</label><button type="button" disabled={group.lines.length>=200||!result.sources.some((s:any)=>s.filename===group.lines[0]?.locator?.filename&&s.sha256)} onClick={appendLine}>补录漏行</button></div>
      <div ref={workspace} className="bom-review-workspace"><BomSourceReview line={activeLine} documents={documents} base={context?.base??''} onBack={returnToLine}/><div>
      {group.lines.map((line:any,index:number)=>!pendingOnly||pending(line)?<PreviewLine key={group.id+':'+(line.reviewId??index)} line={line} index={index} reviewKey={group.id+':'+(line.reviewId??index)} active={(group.id+':'+(line.reviewId??index))===selected} locate={()=>locate(group.id+':'+(line.reviewId??index))} change={value=>changeLine(index,value)}/>:null)}
      {pendingOnly&&!group.lines.some(pending)&&<p role="status">当前没有待处理明细，可取消筛选查看全部。</p>}
      </div></div>
      <label className="check"><input type="checkbox" checked={Boolean(group.reviewed)} onChange={e=>changeGroup({...group,reviewed:e.target.checked})}/>已对照原资料核对本装配的组件、单件用量和计量单位</label>
      {!canAdoptBom(result,currentProductId)&&<p className="muted">填入前请匹配父产品和全部组件、补齐有效用量、排除重复明细并完成核对；最多200行。每次仅填入当前装配，其他装配需分别建立BOM。</p>}
    </>}
  </>;
}
