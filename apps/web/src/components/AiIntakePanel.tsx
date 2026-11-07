import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, tenantApi, errorText } from '../api';
import { useApiData } from '../hooks';
import { Field, Notice, InfoTip } from '../components';
import './ai-intake.css';
import { useBomVisionTask } from './useBomVisionTask';
import { useBomReviewDraft } from './useBomReviewDraft';
import { Link } from 'react-router-dom';

export type DocumentSource={filename:string;data:string;productCode?:string;revision?:string};
type Source={text:string;image?:{mime:'image/png'|'image/jpeg';data:string}};
type Props<T>={tenantKey:string;appId:'erp'|'crm'|'mes';kind:string;title:string;placeholder:string;maxText?:number;files?:boolean;textLabel?:string;enabled?:boolean;images?:boolean;documentIntake?:boolean;productId?:string;formStamp:string;hasValues?:boolean;render:(result:T,update:(result:T)=>void,source:{documents:DocumentSource[]})=>ReactNode;onApply:(result:T)=>void;canApply?:(result:T)=>boolean;onBusyChange?:(busy:boolean)=>void;onReviewDirtyChange?:(dirty:boolean)=>void};

/** Recognition prepares a preview. Only an explicit adopt click changes a form. */
export function AiIntakePanel<T>({tenantKey,appId,kind,title,placeholder,maxText=12000,files=true,textLabel='资料文字',enabled=true,images=false,documentIntake=false,productId,formStamp,hasValues=false,render,onApply,canApply,onBusyChange,onReviewDirtyChange}:Props<T>){
  const path=tenantApi(tenantKey,`/apps/${appId}/${documentIntake?'boms':'ai'}`),status=useApiData<any>(enabled&&!documentIntake?path+'/status':null),noticeMode=status.data?.ai.mode==='notice'||status.data?.ai.modelInvocationEnabled===false,available=enabled&&(documentIntake||(!noticeMode&&status.data?.ai.enabled&&status.data?.ai.configured));
  const options=useApiData<any>(available&&(images||documentIntake)?path+'/intake/options':null);
  const [documents,setDocuments]=useState<DocumentSource[]>([]);
  const [text,setText]=useState(''),[image,setImage]=useState<Source['image']>(),[filename,setFilename]=useState(''),[result,setResult]=useState<T|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  const current=useRef({formStamp,scope:`${tenantKey}:${appId}:${kind}`}),generation=useRef(0),running=useRef(false),prepared=useRef(''),preview=useRef<HTMLElement|null>(null);
  current.current={formStamp,scope:`${tenantKey}:${appId}:${kind}`};
  useEffect(()=>()=>{generation.current++;},[]);
  useEffect(()=>{generation.current++;setText('');setDocuments([]);setImage(undefined);setFilename('');setResult(null);setError(null);setNotice(null);},[tenantKey,appId,kind]);
  useEffect(()=>{if(result===null)return;const frame=requestAnimationFrame(()=>preview.current?.scrollIntoView({block:'nearest',behavior:'smooth'}));return()=>cancelAnimationFrame(frame);},[result]);
  const vision=useBomVisionTask(path,Boolean(enabled&&documentIntake),{
    start:()=>{prepared.current=current.current.formStamp;setResult(null);setError(null);setNotice(null);},
    busy:(value)=>{running.current=value;setBusy(value);onBusyChange?.(value);},
    result:(value)=>setResult(value),error:setError,
  });
  const review=useBomReviewDraft(path,vision.task,result,onReviewDirtyChange);
  const locked=busy||Boolean(vision.pending)||review.dirty||review.saving;
  const invalidate=()=>{generation.current++;setResult(null);setNotice(null);if(!vision.pending)vision.clear();};
  async function documentFiles(selected:FileList|null){
    if(!selected?.length)return;invalidate();setError(null);const token=generation.current;
    try{
      if(documents.length+selected.length>6)throw Error('每次最多选择6份资料');
      if(documents.reduce((n,d)=>n+Math.floor(d.data.length*3/4),0)+Array.from(selected).reduce((n,f)=>n+f.size,0)>8388608)throw Error('资料合计不能超过8MiB');
      const prepared:DocumentSource[]=[];
      for(const file of Array.from(selected)){
        if(!/\.(pdf|xls|xlsx|pcbdoc|csv|tsv|txt|png|jpe?g)$/i.test(file.name))throw Error('支持PDF、PNG/JPEG、XLS/XLSX、PCB6布局文件、CSV、TSV和TXT');
        if(/\.(png|jpe?g)$/i.test(file.name)){const bitmap=await createImageBitmap(file);const valid=bitmap.width*bitmap.height<=12000000&&Math.max(bitmap.width,bitmap.height)<=10000;bitmap.close();if(!valid)throw Error('图片超过1200万像素，请裁剪明细区域');}
        const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(file);});
        if([...documents,...prepared].some(d=>d.data===data))throw Error('已选择相同文件，请移除重复项');
        prepared.push({filename:file.name,data});
      }
      if(generation.current===token)setDocuments([...documents,...prepared]);
    }catch(e){if(generation.current===token)setError(errorText(e));}
  }
  async function file(file:File|undefined){
    if(!file)return;
    invalidate();setError(null);
    const token=generation.current;
    try{
      if(file.size>2097152)throw Error('文件不能超过2MB');
      if(/\.(txt|csv)$/i.test(file.name)){
        const content=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());if(content.length>maxText)throw Error(`文字超过${maxText}字，请分批整理`);
        if(generation.current!==token)return;
        setText(content);setImage(undefined);setFilename(file.name);return;
      }
      if(!options.data?.imageEnabled||!['image/png','image/jpeg'].includes(file.type))throw Error('当前支持TXT、CSV文字；图片须先开通识别');
      const bitmap=await createImageBitmap(file);const valid=bitmap.width<=4096&&bitmap.height<=4096&&bitmap.width*bitmap.height<=4000000;bitmap.close();
      if(!valid)throw Error('图片超过400万像素，请裁剪明细区域');
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(file);});
      if(generation.current!==token)return;
      setImage({mime:file.type as 'image/png'|'image/jpeg',data});setFilename(file.name);
    }catch(e){if(generation.current===token)setError(errorText(e));}
  }
  async function recognize(){
    if(running.current)return;
    running.current=true;setBusy(true);onBusyChange?.(true);setResult(null);setError(null);setNotice(null);
    const token=generation.current,scope=current.current.scope;
    prepared.current=current.current.formStamp;
    try{
      if(documentIntake&&options.data?.visionEnabled&&documents.some(d=>/\.(pdf|png|jpe?g)$/i.test(d.filename))){
        await vision.submit({kind,...(productId?{productId}:{}),source:{text,documents}});return;
      }
      const value=await api.post<T>(path+'/intake',{kind,...(documentIntake&&productId?{productId}:{}),source:{text,...(documentIntake?{documents}:image?{image}:{})}});
      if(token!==generation.current||scope!==current.current.scope)return;
      setResult(value);
    }catch(e){if(token===generation.current&&scope===current.current.scope)setError(errorText(e));}
    finally{running.current=false;setBusy(false);onBusyChange?.(false);}
  }
  async function localRecognize(){
    if(running.current||vision.pending)return;
    running.current=true;setBusy(true);onBusyChange?.(true);setError(null);setResult(null);prepared.current=current.current.formStamp;
    const token=generation.current;
    try{
      let chosen=documents,chosenText=text;
      if(!chosen.length&&!chosenText.trim()&&vision.task?.files?.length){
        chosen=[];
        for(const file of vision.task.files){const value=await api.get<any>(path+'/intake/jobs/'+vision.task.id+'/sources/'+file.id,{timeoutMs:20000});if(value.sha256!==file.sha256)throw Error('原件校验失败');if(file.filename==='粘贴资料.tsv')chosenText=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.data),c=>c.charCodeAt(0)));else chosen.push({filename:file.filename,data:value.data,productCode:file.productCode,revision:file.revision});}
        setDocuments(chosen);setText(chosenText);
      }
      const value=await api.post<T>(path+'/intake',{kind,...(productId?{productId}:{}),source:{text:chosenText,documents:chosen}});
      if(token!==generation.current)return;
      vision.clear();setResult(value);setNotice('已完成本地整理，请对照原资料核对');
    }catch(e){if(token===generation.current)setError(errorText(e));}
    finally{running.current=false;setBusy(false);onBusyChange?.(false);}
  }
  const stale=result!==null&&prepared.current!==formStamp;
  return <section className="panel form-panel ai-intake"><h2>{title}</h2>{documentIntake&&<Link to={`/t/${encodeURIComponent(tenantKey)}/mes/boms/tasks`}>查看整理任务</Link>}
    {!available&&<Notice tone="info" text={status.error?'暂时无法检查AI服务':status.loading?'正在检查AI服务…':noticeMode?(status.data?.ai.message||'AI 服务暂未开放，你可以先使用应用内的业务功能。'):'AI暂不可用，可继续手动填写'}/>}
    <Field label={textLabel}><textarea rows={5} maxLength={maxText} disabled={locked} value={text} onChange={e=>{invalidate();setText(e.target.value);}} placeholder={placeholder}/></Field>
    {documentIntake&&<InfoTip label="BOM资料要求">支持PDF、图片、XLS/XLSX、CSV等物料清单及PCB6布局清点，最多6份、合计8MiB。PCB对象数量须核对装配版本和贴装状态后采用。图片和扫描页可使用视觉模型；整页明细过小或照片复杂时，请先裁剪并保留表头与首尾行。后台原件保留7天，重新打开可恢复进度。</InfoTip>}
    <div className="form-actions">{files&&<label className="button ai-intake-file">选择资料<input aria-label={title+'选择资料'} type="file" multiple={documentIntake} disabled={locked||!available} accept={documentIntake?'.pdf,.xls,.xlsx,.PcbDoc,.csv,.tsv,.txt,.png,.jpg,.jpeg':images&&options.data?.imageEnabled?'.txt,.csv,image/png,image/jpeg':'.txt,.csv'} onChange={e=>{if(documentIntake)void documentFiles(e.target.files);else void file(e.target.files?.[0]);e.target.value='';}}/></label>}
      {filename&&<><span className="ai-intake-filename">{filename}</span><button type="button" disabled={locked} onClick={()=>{invalidate();setFilename('');setImage(undefined);}}>移除文件</button></>}
      <button type="button" disabled={locked||!available||(!image&&!documents.length&&text.trim().length<1)} onClick={()=>void recognize()}>{busy?'整理中…':documentIntake?'整理BOM':'AI整理'}</button>{documentIntake&&!vision.pending&&(options.data?.visionEnabled||vision.task)&&<button type="button" disabled={locked} onClick={()=>void localRecognize()}>本地整理（不调用模型）</button>}</div>
    {documentIntake&&vision.task&&<div className="ai-intake-task" aria-live="polite">
      {vision.pending&&<p>后台整理中 · 已处理 {vision.task.cursor??0} / {vision.task.totalPages??'待确认'} 页；可以离开后恢复。</p>}
      {vision.pending&&!vision.polling&&<button type="button" onClick={()=>void vision.resume()}>恢复后台进度</button>}
      {vision.pending&&<button type="button" onClick={()=>void vision.cancel()}>停止识别</button>}
      {!vision.pending&&Array.isArray(vision.task.usage)&&<details><summary>识别来源与用量</summary>
        <p>已知输入 {vision.task.usage?.reduce((n:number,u:any)=>n+(u.inputTokens??0),0)??0} Token · 输出 {vision.task.usage?.reduce((n:number,u:any)=>n+(u.outputTokens??0),0)??0} Token；推理已含输出。{vision.task.usage?.some((u:any)=>u.usageStatus!=='reported')?'存在待核对用量，不能视为0消耗。':''}</p>
        {vision.task.pages?.map((p:any)=><div key={p.pageIndex}><p>{p.filename} · 第{p.page}页 · {p.models?.length?p.models.join(' / '):'本地解析'} · {p.rows}行候选</p>{p.hasDifference&&<p>两模型存在差异，须对照原件核对。</p>}{vision.task.status==='completed'&&p.canRecheck&&<button type="button" disabled={busy||review.dirty||review.saving} onClick={()=>void vision.recheck(p.pageIndex)}>复核此页并重置核对</button>}</div>)}
      </details>}
    </div>}
    {documents.length>0&&<ul className="ai-intake-documents">{documents.map((d,n)=><li key={n}><span>{d.filename}</span><Field label="资料产品编码（可选）"><input maxLength={100} value={d.productCode??''} disabled={locked} onChange={e=>{invalidate();setDocuments(documents.map((x,i)=>i===n?{...x,productCode:e.target.value}:x));}}/></Field><Field label="资料版本（可选）"><input maxLength={80} value={d.revision??''} disabled={locked} onChange={e=>{invalidate();setDocuments(documents.map((x,i)=>i===n?{...x,revision:e.target.value}:x));}}/></Field><a download={d.filename} href={`data:application/octet-stream;base64,${d.data}`}>下载原文件</a><button type="button" disabled={locked} onClick={()=>{invalidate();setDocuments(documents.filter((_,i)=>i!==n));}}>移除</button>{/\.(png|jpe?g)$/i.test(d.filename)&&<details className="ai-intake-original"><summary>预览原图</summary><img alt={d.filename} src={`data:image/${/\.png$/i.test(d.filename)?'png':'jpeg'};base64,${d.data}`}/></details>}</li>)}</ul>}
    {image&&<img className="ai-intake-source" alt="待识别原图" src={`data:${image.mime};base64,${image.data}`}/>}
    <Notice text={error||options.error}/><Notice tone="success" text={notice}/>
    {vision.task?.status==='completed'&&result!==null&&<div className="form-actions" aria-label="核对暂存">
      <span role="status">{review.saving?'正在暂存…':review.dirty?'有尚未暂存的核对修改':review.savedAt?'核对已暂存 · '+new Date(review.savedAt).toLocaleTimeString('zh-CN'):'修改后自动暂存到当前账号'}</span>
      <button type="button" disabled={review.saving||!review.dirty} onClick={()=>void review.save()}>{review.blocked?'重试暂存':'暂存核对'}</button>
      {review.blocked&&<button type="button" onClick={()=>{if(window.confirm('重新载入将替换当前核对修改，是否继续？'))void vision.resume();}}>重新载入服务端暂存</button>}
      {vision.task.review?.invalidated&&<p>已恢复修改；物料状态或单位已变化，相关行须重新核对。</p>}
    </div>}
    <Notice text={review.error}/>
    {result!==null&&<section ref={preview} className="ai-intake-preview" aria-label={documentIntake?'BOM整理结果':'AI整理结果'}><h3>核对结果</h3>{render(result,setResult,{documents})}
      <Notice tone="info" text={stale?'表单已修改，请重新整理后采用':null}/>
      <button type="button" className="primary" disabled={stale||review.saving||review.dirty||canApply?.(result)===false} onClick={()=>{onApply(result);vision.clear();setResult(null);setNotice('已填入表单，核对后保存');}}>{hasValues?'采用并替换表单':'填入表单'}</button></section>}
  </section>;
}

export function IntakeWarnings({items}:{items:string[]}){return items.length?<ul className="ai-intake-warnings">{items.map((s,i)=><li key={i}>{s}</li>)}</ul>:null;}
