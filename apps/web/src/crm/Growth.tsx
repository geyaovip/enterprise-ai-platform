import { DialogAction } from '../components';
import {useEffect, useRef, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {Notice, Dialog, DataResult, Empty, InfoTip} from '../components';
import {useCrm, api, date, Table} from './common';
type Resource = {data: any; loading: boolean; error: string | null; reload: () => Promise<unknown>};
export function CrmGrowthBoard({currency, resource: d}: {currency: string; resource: Resource}) {
 const c=useCrm(),nav=useNavigate(),[selected,setSelected]=useState<any>(null),[preview,setPreview]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const generation=useRef(0),scope=useRef({base:c.base,currency}),running=useRef(false);
 if(scope.current.base!==c.base||scope.current.currency!==currency){scope.current={base:c.base,currency};generation.current++;running.current=false;}
 useEffect(()=>{setSelected(null);setPreview(null);setBusy(false);setError(null);},[currency,c.base]);
 useEffect(()=>()=>{generation.current++;},[]);
 if(!c.can('crm.segment.read'))return null;
 const inspect=async(s:any)=>{if(running.current)return;running.current=true;const version=++generation.current;setBusy(true);setError(null);
  try{const p=await api.post<any>(c.base+'/segments/preview',{rule:s.rule});if(version===generation.current){setPreview(p);setSelected(s);}}
  catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'人群预览失败，请重试');}
  finally{if(version===generation.current){running.current=false;setBusy(false);}}
 };
 return <section className="panel crm-overview-panel">
 <div className="crm-overview-heading"><h2>客户运营</h2><Link to={c.prefix+'/segments'}>查看分群</Link></div>
 <Notice text={error}/><DataResult {...d}>
 {d.data?.scenarios?.length?<ul className="crm-growth-list">{d.data.scenarios.map((s:any)=><li className="crm-growth-row" key={s.id}>
 <span><strong>{s.name} <InfoTip label={s.name+'筛选条件'}>{s.description}</InfoTip></strong></span><strong>{s.memberCount}<small> 人</small></strong>
 <button type="button" aria-label={'查看'+s.name+'方案'} disabled={busy||!s.memberCount} onClick={()=>void inspect(s)}>{busy?'计算中…':'查看方案'}</button>
 </li>)}</ul>:<Empty text="暂无可用客户分群"/>}
 {d.data&&<p className="muted crm-growth-updated">{currency} · 更新于 {date(d.data.asOf)}{d.data.metadata?.metricsStatus!=='ready'&&d.data.metadata?' · 指标更新中':''}</p>}
 </DataResult><Dialog open={!!selected} title={selected?.plan.title??'运营方案'} size="large" onClose={()=>{setSelected(null);setPreview(null);}}><p>{selected?.description}</p><p>本次预览：{preview?.memberCount} 位客户 · {preview?.currency} · 有效至 {date(preview?.expiresAt)}</p>{preview?.sample?.length>0&&<Table headers={['客户','距最近购买','历史净消费']}>{preview.sample.map((r:any)=><tr key={r.id}><td>{r.displayName}</td><td>{r.recencyDays==null?'无购买':r.recencyDays+' 天'}</td><td>{r.lifetimeNetAmount} {preview.currency}</td></tr>)}</Table>}<h3>目标</h3><p>{selected?.plan.goal}</p><h3>沟通与执行建议</h3><p className="crm-prose">{selected?.plan.planText}</p><ol>{selected?.plan.checklist.map((x:any)=><li key={x.stableId}>{x.text}</li>)}</ol>{selected?.canCreate&&<DialogAction><button className="primary" disabled={!preview?.memberCount||!preview?.usableForTask} onClick={()=>nav(c.prefix+'/tasks?evaluationId='+preview.evaluationId+'&previewHash='+preview.previewHash,{state:{crmDraft:{title:selected.plan.title,goal:selected.plan.goal,planText:selected.plan.planText,checklist:selected.plan.checklist,hypotheses:[],currency:preview.currency,trackCustomers:true,ownerMembershipId:null,dueAt:new Date(Date.now()+3*86400000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)}}})}>使用方案创建草稿</button></DialogAction>}</Dialog></section>;
}
