import {useEffect,useRef,useState} from 'react';
import {api,useCrm} from './common';
import {Notice} from '../components';
import {errorText} from '../api';
import {useApiData} from '../hooks';
import {IntakeWarnings} from '../components/AiIntakePanel';

export function MappingAssist({batch,role,mapping,onChange,fieldNames}:{batch:any;role:string;mapping:any;onChange:(value:any)=>void;fieldNames:Record<string,string>}){
  const c=useCrm(),[busy,setBusy]=useState(false),[result,setResult]=useState<any>(null),[error,setError]=useState<string|null>(null),stamp=JSON.stringify([batch.id,batch.version,mapping]),current=useRef(''),requested=useRef(''),running=useRef(false),mounted=useRef(true);
  current.current=stamp;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const permitted=c.can('crm.ai.use')&&c.can('crm.import.write'),status=useApiData<any>(permitted?c.base+'/ai/status':null),noticeMode=status.data?.ai.mode==='notice'||status.data?.ai.modelInvocationEnabled===false;
  if(!permitted)return null;
  return <div className="ai-intake">{noticeMode&&<Notice tone="info" text={status.data?.ai.message||'AI 服务暂未开放，你可以先使用应用内的业务功能。'}/>}<button type="button" disabled={busy||status.loading||noticeMode} onClick={async()=>{
    if(running.current)return;running.current=true;setBusy(true);setError(null);setResult(null);requested.current=stamp;
    try{const value=await api.post(c.base+'/ai/intake',{kind:'import_mapping',batchId:batch.id,version:batch.version,role});if(mounted.current&&current.current===requested.current)setResult(value);}
    catch(e){if(mounted.current)setError(errorText(e));}finally{running.current=false;if(mounted.current)setBusy(false);}
  }}>{busy?'整理中…':'AI补充字段匹配'}</button><Notice text={error}/>{result&&<section className="ai-intake-preview"><h4>建议字段</h4>{Object.entries(result.fields).map(([target,source]:any)=><p key={target}>{fieldNames[target]??target} ← {source}{mapping.fields?.[role]?.[target]?'（已有映射保留）':''}</p>)}<IntakeWarnings items={result.uncertainties}/><button type="button" disabled={stamp!==requested.current} onClick={()=>{
    // Existing manual/automatic choices always win. AI only fills blank fields.
    const fields={...mapping.fields?.[role]};
    const used=new Set<string>();for(const [target,source]of Object.entries(mapping.fields?.[role]??{}))if(source)used.add(String(source));
    for(const [target,source]of Object.entries(result.fields))if(!fields[target]&&!used.has(String(source))){fields[target]=source;used.add(String(source));}
    onChange({...mapping,fields:{...mapping.fields,[role]:fields}});setResult(null);
  }}>采用空缺字段</button></section>}</div>;
}
