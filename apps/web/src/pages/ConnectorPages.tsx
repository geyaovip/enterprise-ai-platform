import { ChoiceSelect } from '../components';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { useApiData } from '../hooks';
import { Field, Loading, Notice, ConfirmDialog } from '../components';

function Frame({title,children}:{title:string;children:ReactNode}){
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[title]);
  return <main className="connector-page"><header><Link to="/tenants">知行方舟</Link><Link to="/connect/connections">已连接应用</Link></header><section className="panel"><h1 tabIndex={-1} ref={heading}>{title}</h1>{children}</section></main>;
}
type Consent={id:string;appId:string;name:string;clientName:string;requestedScopes:string[];expiresAt:string;tenants:{key:string;name:string;draftAllowed:boolean}[];nonce:string};
export function ConnectorAuthorizePage(){
  const [params]=useSearchParams(),id=params.get('request'),details=useApiData<Consent>(id?'/connect/requests/'+encodeURIComponent(id):null);
  const [tenant,setTenant]=useState(''),[draft,setDraft]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  useEffect(()=>{if(details.data?.tenants.length)setTenant(details.data.tenants[0].key);},[details.data]);
  const selected=details.data?.tenants.find(t=>t.key===tenant),draftRequested=details.data?.requestedScopes.includes(details.data.appId+'.draft');
  const submit=async(decision:'allow'|'deny')=>{
    if(!id||!details.data||busy)return;setBusy(true);setError(null);
    try{const r=await api.post<{redirect:string}>('/connect/requests/'+encodeURIComponent(id),{nonce:details.data.nonce,decision,...(tenant?{tenantKey:tenant}:{}),allowDraft:Boolean(draft&&draftRequested&&selected?.draftAllowed)});window.location.assign(r.redirect);}
    catch(e){setError(errorText(e));setBusy(false);}
  };
  return <Frame title={details.data?'连接 '+details.data.name:'连接应用'}>
    <Notice text={error??details.error}/>
    {!id?<Notice text="连接请求不完整，请回 WorkBuddy 重新连接。"/>:details.loading&&!details.data?<Loading/>:details.data&&<>
      <p>连接后，WorkBuddy 可以按你当前的业务权限使用这个应用。请确认这是你刚发起的连接。</p>
      <ChoiceSelect label="授权企业" value={tenant} onChange={e=>setTenant(e.target.value)} disabled={busy||!details.data.tenants.length}>{!details.data.tenants.length&&<option value="">暂无可授权企业</option>}{details.data.tenants.map(t=><option key={t.key} value={t.key}>{t.name}</option>)}</ChoiceSelect>
      {!details.data.tenants.length&&<p>当前没有可使用该应用的企业。你可以<Link to="/onboarding">创建或加入企业</Link>，或联系管理员分配岗位后重新连接。</p>}
      <div className="connector-permissions"><h2>允许访问</h2><p>查询当前岗位有权查看的业务数据，计算业务预览。</p>{draftRequested&&<label><input type="checkbox" checked={draft&&Boolean(selected?.draftAllowed)} onChange={e=>setDraft(e.target.checked)} disabled={busy||!selected?.draftAllowed}/>准备业务草稿；每次保存仍需你确认</label>}<p className="muted">授权仅针对所选企业和应用，有效期最长30天。可以随时撤销；成员或业务权限变化后按最新权限执行。</p></div>
      <div className="connector-actions"><button className="primary" disabled={busy||!selected} onClick={()=>void submit('allow')}>{busy?'正在处理…':'同意并连接'}</button><button disabled={busy} onClick={()=>void submit('deny')}>取消连接</button></div>
    </>}
  </Frame>;
}

type Action={actionId:string;appId:string;status:string;version:number;fingerprint:string;expiresAt:string;parameters:Record<string,unknown>;connectionActive:boolean;receipt?:Record<string,unknown>&{destination?:string};tenantKey:string};
function Details({value}:{value:unknown}):ReactNode{
  if(value===null||value===undefined||value==='')return <span className="muted">未指定</span>;
  if(Array.isArray(value))return <ul className="connector-values">{value.map((v,i)=><li key={i}><Details value={v}/></li>)}</ul>;
  if(typeof value==='object')return <dl className="connector-details">{Object.entries(value).map(([k,v])=><div key={k}><dt>{k}</dt><dd><Details value={v}/></dd></div>)}</dl>;
  return <span>{String(value)}</span>;
}
export function ConnectorActionPage(){
  const {id}=useParams(),data=useApiData<Action>(id?'/connect/actions/'+encodeURIComponent(id):null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const action=data.data,expired=!!action&&Date.parse(action.expiresAt)<=Date.now();
  const decide=async(decision:'confirm'|'cancel')=>{
    if(!action||busy)return;setBusy(true);setError(null);
    try{await api.post('/connect/actions/'+action.actionId,{decision,version:action.version,fingerprint:action.fingerprint});await data.reload();}
    catch(e){setError(errorText(e));await data.reload();}finally{setBusy(false);}
  };
  return <Frame title={action?.status==='completed'?'业务草稿已保存':'核对业务操作'}><Notice text={error??data.error}/>{data.loading&&!action?<Loading/>:action&&<>
    <Details value={action.parameters}/>
    {action.status==='completed'?<><p role="status">草稿已保存，可以返回 WorkBuddy 查看结果。</p>{action.receipt&&<dl className="connector-details"><div><dt>单据编号</dt><dd>{String(action.receipt.number??action.receipt.id)}</dd></div><div><dt>状态</dt><dd>草稿</dd></div></dl>}{action.receipt?.destination&&<a className="button primary" href={action.receipt.destination}>查看业务草稿</a>}</>:action.status!=='pending'?<p role="status">这项操作已取消，未保存业务草稿。</p>:<>
      {!action.connectionActive?<Notice text="连接授权已失效，请回 WorkBuddy 重新连接。"/>:expired?<Notice text="操作已过期，请回 WorkBuddy 重新准备。"/>:<p>确认后会保存以上业务草稿。审批、发送、发布及派工仍需按业务流程另行办理。</p>}
      <div className="connector-actions"><button className="primary" disabled={busy||expired||!action.connectionActive} onClick={()=>void decide('confirm')}>{busy?'正在保存…':'确认保存草稿'}</button><button disabled={busy||expired||!action.connectionActive} onClick={()=>void decide('cancel')}>不执行</button></div>
    </>}
  </>}</Frame>;
}

type Connection={id:string;name:string;tenantName:string;scopes:string[];status:string;expiresAt:string;lastUsedAt:string|null};
export function ConnectorConnectionsPage(){
  const data=useApiData<Connection[]>('/connect/connections'),[selected,setSelected]=useState<Connection|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const revoke=async()=>{if(!selected||busy)return;setBusy(true);try{await api.post('/connect/connections/'+selected.id+'/revoke',{});setSelected(null);await data.reload();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  return <Frame title="已连接应用"><Notice text={error??data.error}/>{data.loading&&!data.data?<Loading/>:!data.data?.length?<p>还没有连接外部应用。可以在 WorkBuddy 中添加对应的知行方舟连接器。</p>:<div className="connector-list">{data.data.map(c=><article key={c.id}><div><h2>{c.name}</h2><p>{c.tenantName} · {c.status==='active'?'已授权':c.status==='revoked'?'已撤销':'已过期'}</p><p className="muted">权限：查询业务{c.scopes.some(s=>s.endsWith('.draft'))?'、准备草稿':''} · 有效期至{new Date(c.expiresAt).toLocaleDateString('zh-CN')}</p>{c.lastUsedAt&&<p className="muted">最近使用：{new Date(c.lastUsedAt).toLocaleString('zh-CN')}</p>}</div>{c.status==='active'&&<button onClick={()=>{setError(null);setSelected(c);}}>撤销授权</button>}</article>)}</div>}
    <ConfirmDialog open={!!selected} confirmLabel="撤销授权" title="撤销连接授权" description={<p>撤销{selected?.tenantName}的{selected?.name}授权后，WorkBuddy 将无法继续通过这项连接访问业务。</p>} busy={busy} error={error} onCancel={()=>setSelected(null)} onConfirm={()=>void revoke()}/>
  </Frame>;
}
