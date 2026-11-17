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
type Consent={id:string;appId:string;name:string;clientName:string;requestedScopes:string[];expiresAt:string;tenants:{key:string;name:string;draftAllowed:boolean;executionAllowed?:boolean;recordsAllowed?:boolean}[];nonce:string};
export function ConnectorAuthorizePage(){
  const [params]=useSearchParams(),id=params.get('request'),details=useApiData<Consent>(id?'/connect/requests/'+encodeURIComponent(id):null);
  const [tenant,setTenant]=useState(''),[draft,setDraft]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [execution,setExecution]=useState(false),[records,setRecords]=useState(false);
  useEffect(()=>{if(details.data?.tenants.length)setTenant(details.data.tenants[0].key);setExecution(false);setRecords(false);},[details.data]);
  const selected=details.data?.tenants.find(t=>t.key===tenant),draftRequested=details.data?.requestedScopes.includes(details.data.appId+'.draft');
  const executionRequested=details.data?.requestedScopes.includes(details.data.appId+'.execute');
  const recordsRequested=details.data?.requestedScopes.includes(details.data.appId+'.records');
  const readOnlyDescriptions: Record<string,string>={
    content:'查询内容项目和素材信息。',
    geo:'查询 GEO 项目和已有分析报告。',
    manufacturing:'查询制造订单、库存预警、生产进度和批次追溯。',
    erp:'查询库存、采购单和销售合同。',
    crm:'查询岗位授权范围内的客户、线索、商机和跟进。',
    mes:'查询工单、报工记录和物料清单。',
  };
  const clientName=details.data?.clientName?.trim()||'外部客户端';
  const submit=async(decision:'allow'|'deny')=>{
    if(!id||!details.data||busy)return;setBusy(true);setError(null);
    try{const r=await api.post<{redirect:string}>('/connect/requests/'+encodeURIComponent(id),{nonce:details.data.nonce,decision,...(tenant?{tenantKey:tenant}:{}),allowDraft:Boolean(draft&&draftRequested&&selected?.draftAllowed),...(executionRequested?{allowExecution:Boolean(execution&&selected?.executionAllowed)}:{}),...(recordsRequested?{allowRecords:Boolean(records&&selected?.recordsAllowed)}:{})});window.location.assign(r.redirect);}
    catch(e){setError(errorText(e));setBusy(false);}
  };
  return <Frame title={details.data?'连接 '+details.data.name:'连接应用'}>
    <Notice text={error??details.error}/>
    {!id?<Notice text="连接请求不完整，请返回发起连接的客户端重新连接。"/>:details.loading&&!details.data?<Loading/>:details.data&&<>
      <p>发起客户端：<strong>{clientName}</strong>。请核对这是你刚发起的连接，再选择要授权的企业。</p>
      <ChoiceSelect label="授权企业" value={tenant} onChange={e=>{setTenant(e.target.value);setExecution(false);setRecords(false);}} disabled={busy||!details.data.tenants.length}>{!details.data.tenants.length&&<option value="">暂无可授权企业</option>}{details.data.tenants.map(t=><option key={t.key} value={t.key}>{t.name}</option>)}</ChoiceSelect>
      {!details.data.tenants.length&&<p>当前没有可使用该应用的企业。你可以<Link to="/onboarding">创建或加入企业</Link>，或联系管理员分配岗位后重新连接。</p>}
      <div className="connector-permissions"><h2>允许访问</h2><p>只读访问：{readOnlyDescriptions[details.data.appId]??'查询当前岗位有权查看的业务数据。'}</p>
      {draftRequested&&<label><input type="checkbox" checked={draft&&Boolean(selected?.draftAllowed)} onChange={e=>setDraft(e.target.checked)} disabled={busy||!selected?.draftAllowed}/>准备业务草稿；每次保存仍需你确认</label>}
      {recordsRequested&&<label><input type="checkbox" checked={records&&Boolean(selected?.recordsAllowed)} onChange={e=>setRecords(e.target.checked)} disabled={busy||!selected?.recordsAllowed}/>允许准备新增、修改和删除提案，每次操作由我在知行方舟确认</label>}
      {executionRequested&&<label><input type="checkbox" checked={execution&&Boolean(selected?.executionAllowed)} onChange={e=>setExecution(e.target.checked)} disabled={busy||!selected?.executionAllowed}/>{details.data.appId==='content'?'允许提交图片或视频生成':'允许提交 GEO 分析'}，可能产生模型费用</label>}
      <p className="muted">授权仅针对所选企业和应用，有效期最长30天。可以随时撤销；成员或业务权限变化后按最新权限执行。</p></div>
      <div className="connector-actions"><button className="primary" disabled={busy||!selected} onClick={()=>void submit('allow')}>{busy?'正在处理…':'同意并连接'}</button><button disabled={busy} onClick={()=>void submit('deny')}>取消连接</button></div>
    </>}
  </Frame>;
}

type Action={actionId:string;appId:string;status:string;version:number;fingerprint:string;expiresAt:string;parameters:Record<string,unknown>;connectionActive:boolean;receipt?:Record<string,unknown>&{destination?:string};tenantKey:string;tenantName?:string;kind?:'record'|'draft';operation?:'create'|'update'|'delete'};
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
  const isRecord=action?.kind==='record';
  const confirmLabel=isRecord?(action.operation==='delete'?'确认删除':'确认保存'):'确认保存草稿';
  const receiptStatuses:Record<string,string>={draft:'草稿',pending_approval:'待审核',cancelled:'已取消',inactive:'已停用',trashed:'回收站',saved:'已保存'};
  const status=String(action?.receipt?.status??'draft');
  return <Frame title={action?.status==='completed'?(isRecord?'操作已完成':'业务草稿已保存'):'核对业务操作'}>
    <Notice text={error??data.error}/>
    {data.loading&&!action?<Loading/>:action&&<>
      <p>企业：<strong>{action.tenantName??action.tenantKey}</strong></p>
      <Details value={action.parameters}/>
      {action.status==='completed'?<>
        <p role="status">操作已保存。可以返回发起操作的客户端查看回执。</p>
        {action.receipt&&<dl className="connector-details">
          <div><dt>记录</dt><dd>{String(action.receipt.number??action.receipt.title??action.receipt.id)}</dd></div>
          <div><dt>状态</dt><dd>{receiptStatuses[status]??status}</dd></div>
        </dl>}
        {action.receipt?.destination&&<a className="button primary" href={action.receipt.destination}>查看业务记录</a>}
      </>:action.status!=='pending'?<p role="status">这项操作已取消，业务记录未变化。</p>:<>
        {!action.connectionActive?<Notice text="连接授权已失效，请返回发起客户端重新连接。"/>:
          expired?<Notice text="操作已过期，请返回发起客户端重新准备。"/>:
          <p>{isRecord?'请核对改动内容和处理结果，确认后立即生效。':'确认后保存草稿，后续审批按工作台业务流程办理。'}</p>}
        <div className="connector-actions">
          <button className="primary" disabled={busy||expired||!action.connectionActive} onClick={()=>void decide('confirm')}>{busy?'正在处理…':confirmLabel}</button>
          <button disabled={busy||expired||!action.connectionActive} onClick={()=>void decide('cancel')}>不执行</button>
        </div>
      </>}
    </>}
  </Frame>;
}

type Connection={id:string;name:string;clientName?:string;tenantName:string;scopes:string[];status:string;expiresAt:string;lastUsedAt:string|null};
export function ConnectorConnectionsPage(){
  const data=useApiData<Connection[]>('/connect/connections'),[selected,setSelected]=useState<Connection|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const revoke=async()=>{if(!selected||busy)return;setBusy(true);try{await api.post('/connect/connections/'+selected.id+'/revoke',{});setSelected(null);await data.reload();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  return <Frame title="已连接应用"><Notice text={error??data.error}/>{data.loading&&!data.data?<Loading/>:!data.data?.length?<p>还没有连接外部应用。请在你使用的客户端添加对应的知行方舟插件或连接器。</p>:<div className="connector-list">{data.data.map(c=><article key={c.id}><div><h2>{c.name}</h2><p>{c.tenantName} · {c.clientName||'外部客户端'} · {c.status==='active'?'已授权':c.status==='revoked'?'已撤销':'已过期'}</p><p className="muted">权限：查询业务{c.scopes.some(s=>s.endsWith('.draft'))?'、准备草稿':''}{c.scopes.some(s=>s.endsWith('.records'))?'、准备记录操作':''} · 有效期至{new Date(c.expiresAt).toLocaleDateString('zh-CN')}</p>{c.lastUsedAt&&<p className="muted">最近使用：{new Date(c.lastUsedAt).toLocaleString('zh-CN')}</p>}</div>{c.status==='active'&&<button onClick={()=>{setError(null);setSelected(c);}}>撤销授权</button>}</article>)}</div>}
    <ConfirmDialog open={!!selected} confirmLabel="撤销授权" title="撤销连接授权" description={<p>撤销{selected?.tenantName}的{selected?.name}授权后，{selected?.clientName||'该客户端'}将无法继续通过这项连接访问业务。</p>} busy={busy} error={error} onCancel={()=>setSelected(null)} onConfirm={()=>void revoke()}/>
  </Frame>;
}
