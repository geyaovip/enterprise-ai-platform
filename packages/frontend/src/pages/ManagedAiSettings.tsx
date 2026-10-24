import { useState } from 'react';
import { api, aiApi, errorText } from '../api';
import { useApiData } from '../hooks';
import { PasswordInput,Dialog, Field, Notice } from '../components';

export function ManagedAiSettings({tenantKey,onSaved}:{tenantKey:string;onSaved:()=>Promise<void>}){
 const settings=useApiData<{configured:boolean;model?:string;baseUrl?:string}>(aiApi(tenantKey,'/settings'));
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[form,setForm]=useState({model:'',baseUrl:'',apiKey:''});
 return <><section className="panel"><div className="panel-heading"><h2>企业 AI 模型</h2><button onClick={()=>{setForm({model:settings.data?.model??'',baseUrl:settings.data?.baseUrl??'',apiKey:''});setError(null);setOpen(true);}}>配置模型</button></div><Notice text={settings.error}/><p>{settings.data?.configured?settings.data.model:'平台默认模型'}</p></section><Dialog open={open} title="配置企业 AI 模型" onClose={()=>{setOpen(false);setForm({...form,apiKey:''});}} busy={busy} dirtyCheck><Notice text={error}/><form className="form-panel" onSubmit={async e=>{e.preventDefault();setBusy(true);setError(null);try{await api.put(aiApi(tenantKey,'/settings'),form);await settings.reload();await onSaved();setOpen(false);setForm({...form,apiKey:''});}catch(error){setError(errorText(error));}finally{setBusy(false);}}}><Field label="模型名称"><input required maxLength={120} value={form.model} onChange={e=>setForm({...form,model:e.target.value})}/></Field><Field label="模型 API 地址"><input required type="url" value={form.baseUrl} placeholder="https://模型服务域名/v1" onChange={e=>setForm({...form,baseUrl:e.target.value})}/></Field><Field label="API 密钥"><PasswordInput required autoComplete="new-password" minLength={8} maxLength={1000} value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})}/></Field><div className="form-actions"><button className="primary" disabled={busy}>{busy?'保存中…':'保存配置'}</button></div></form></Dialog></>;
}
