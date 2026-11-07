import {useEffect,useId,useState} from 'react';
import {api,errorText} from './api';
import { RecordActions,Dialog,DialogAction,ConfirmDialog,Field,Notice,Loading,Empty,TabBar} from './components';
import {useApiData} from './hooks';
type Entry={id:string;title:string;content:string;kind:'preference'|'convention';visibility:'personal'|'enterprise';version:number;expiresAt:string|null;updatedAt:string;editable:boolean};
type MemoryData={enabled:boolean;items:Entry[];canManageShared:boolean;indexCleanupPending:boolean;engine:{configured:boolean;mode:string}};
const blank={title:'',content:'',kind:'preference' as Entry['kind'],visibility:'personal' as Entry['visibility'],expiresAt:''};
export function AiMemoryPanel({open,base,onClose,onChanged}:{open:boolean;base:string;onClose:()=>void;onChanged?:()=>void}){
 const formId=useId();const[discarding,setDiscarding]=useState(false);
 const data=useApiData<MemoryData>(open?base+'/memory':null);const [form,setForm]=useState(blank);const [editing,setEditing]=useState<Entry|null|undefined>(undefined);const [scope,setScope]=useState<'personal'|'enterprise'>('personal');const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [removing,setRemoving]=useState<Entry|null>(null);
 useEffect(()=>{if(open){setError(null);setEditing(undefined);setRemoving(null);setDiscarding(false);setScope('personal');}},[open,base]);
 const start=(entry:Entry|null)=>{setEditing(entry);setForm(entry?{title:entry.title,content:entry.content,kind:entry.kind,visibility:entry.visibility,expiresAt:entry.expiresAt?.slice(0,10)??''}:{...blank,visibility:scope});setError(null);};
 const back=()=>{const initial=editing?{title:editing.title,content:editing.content,kind:editing.kind,visibility:editing.visibility,expiresAt:editing.expiresAt?.slice(0,10)??''}:{...blank,visibility:scope};if(JSON.stringify(form)!==JSON.stringify(initial))setDiscarding(true);else setEditing(undefined);};
 const save=async()=>{setBusy(true);setError(null);try{const input={...form,expiresAt:form.expiresAt?new Date(form.expiresAt+'T23:59:59').toISOString():null};if(editing)await api.put(base+'/memory/'+editing.id,{...input,version:editing.version});else await api.post(base+'/memory',input);setEditing(undefined);await data.reload();onChanged?.();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 const toggle=async(enabled:boolean)=>{setBusy(true);setError(null);try{await api.put(base+'/memory/preferences',{enabled});await data.reload();onChanged?.();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 const remove=async()=>{if(!removing)return;setBusy(true);setError(null);try{await api.del(base+'/memory/'+removing.id);setRemoving(null);await data.reload();onChanged?.();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 return <><Dialog open={open} title={editing===undefined?'记忆管理':`${editing?'编辑':'新增'}${form.visibility==='personal'?'个人记忆':'企业约定'}`}  onClose={onClose} busy={busy} dirtyCheck={editing!==undefined&&(Boolean(form.title)||Boolean(form.content))}>
  <Notice text={error??data.error}/>{data.loading&&!data.data?<Loading/>:data.data&&<>
   {editing===undefined&&<div className="memory-status"><strong>{data.data.enabled?'记忆已启用':'记忆已暂停'}</strong><button type="button" disabled={busy} onClick={()=>void toggle(!data.data!.enabled)}>{data.data.enabled?'暂停使用':'恢复使用'}</button></div>}
   
   <Notice tone="info" text={data.data.indexCleanupPending?'原文已更新，检索索引正在清理；旧版本不会用于新回答。':undefined}/>
   <Notice tone="info" text={!data.data.engine.configured?'记忆检索服务尚未配置。已保存的常驻偏好可用，其他约定暂不能按问题检索。':undefined}/>
   {editing===undefined?<>
    <div className="memory-toolbar"><TabBar label="记忆范围"><button role="tab" aria-selected={scope==='personal'} className={scope==='personal'?'active':''} onClick={()=>setScope('personal')}>个人记忆</button><button role="tab" aria-selected={scope==='enterprise'} className={scope==='enterprise'?'active':''} onClick={()=>setScope('enterprise')}>企业约定</button></TabBar>{(scope==='personal'||data.data.canManageShared)&&<button className="primary" type="button" disabled={busy} onClick={()=>start(null)}>新增记忆</button>}</div>
    <p className="memory-help">{scope==='personal'?'仅当前企业、当前应用中的你本人可用。':'仅当前企业和当前应用内共享，由管理员维护。'}</p>
    <div className="memory-list">{data.data.items.filter(x=>x.visibility===scope).length===0?<Empty text="还没有保存记忆。"/>:data.data.items.filter(x=>x.visibility===scope).map(x=><article key={x.id} className="memory-item"><div className="memory-item-heading"><h3>{x.title}</h3></div><p>{x.content}</p><div className="memory-item-footer"><span>{x.expiresAt?(new Date(x.expiresAt)<=new Date()?'已过期':'有效至')+' '+x.expiresAt.slice(0,10):'长期有效'}</span>{x.editable&&<RecordActions><button type="button" disabled={busy} onClick={()=>start(x)}>修改</button><button className="danger" type="button" disabled={busy} onClick={()=>setRemoving(x)}>删除</button></RecordActions>}</div></article>)}</div>
   </>:<form id={formId} onSubmit={e=>{e.preventDefault();void save();}} className="memory-form">
    <Field label="标题"><input disabled={busy} value={form.title} maxLength={60} required onChange={e=>setForm({...form,title:e.target.value})}/></Field>
    <Field label="记忆类型"><select disabled={busy} value={form.kind} onChange={e=>setForm({...form,kind:e.target.value as Entry['kind']})}><option value="preference">回答偏好</option><option value="convention">工作约定</option></select></Field>
    <Field label="记忆内容" ><textarea disabled={busy} value={form.content} maxLength={800} rows={5} required onChange={e=>setForm({...form,content:e.target.value})}/></Field>
    <Field label="有效期（可选）"><input disabled={busy} type="date" value={form.expiresAt} onChange={e=>setForm({...form,expiresAt:e.target.value})}/></Field>
    <DialogAction replacesClose><button type="button" disabled={busy} onClick={back}>返回列表</button><button className="primary" disabled={busy} form={formId} type="submit">{busy?'保存中…':'保存记忆'}</button></DialogAction>
   </form>}
  </>}
 </Dialog><ConfirmDialog open={discarding} title="放弃本次修改？" description="修改尚未保存。" confirmPrimary={false} cancelLabel="继续编辑" confirmLabel="放弃修改" onCancel={()=>setDiscarding(false)} onConfirm={()=>{setDiscarding(false);setEditing(undefined);}}/><ConfirmDialog open={Boolean(removing)} confirmLabel="删除记忆" title="删除记忆" error={error} busy={busy} description={<p>删除“{removing?.title}”后，它不会再用于新的回答。聊天原文和必要审计记录仍会保留。</p>} onCancel={()=>setRemoving(null)} onConfirm={()=>void remove()}/></>;
}
