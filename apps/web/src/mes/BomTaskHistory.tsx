import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiData } from '../hooks';
import { PageTitle,ChoiceSelect,Pager,DataResult,Empty } from '../components';
import { useMes } from './common';
const labels:Record<string,string>={queued:'等待处理',running:'处理中',completed:'已完成，待核对',failed:'未完成',cancelled:'已停止',expired:'已过期'};
export function BomTaskHistory(){
 const c=useMes(),[status,setStatus]=useState('all'),[page,setPage]=useState(1),d=useApiData<any>(c.base+`/boms/intake/history?status=${status}&page=${page}&page_size=20`);
 return <><PageTitle title="BOM整理任务" back={<Link to={c.prefix+'/boms'}>返回BOM</Link>} action={<button onClick={()=>void d.reload()}>刷新</button>}/><ChoiceSelect label="任务状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{[['all','全部'],['active','进行中'],['completed','已完成'],['failed','未完成'],['cancelled','已停止'],['expired','已过期']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</ChoiceSelect><DataResult {...d}>
  <p className="muted">仅显示本人在当前企业的任务。原件和核对暂存保留7天；打开历史任务不会重新识别。</p>
  {d.data?.items?.length?<ul className="bom-task-history">{d.data.items.map((t:any)=><li key={t.id}><strong>{t.filenames.join('、')}</strong><p>{t.expired?'已过期':labels[t.status]??t.status} · {new Date(t.createdAt).toLocaleString('zh-CN')}{t.reviewSavedAt?' · 有核对暂存':''}</p>{t.message&&<p>{t.message}</p>}{!t.expired&&<Link to={c.prefix+'/boms/new?bomTask='+t.id}>{t.status==='completed'?'继续核对':'查看任务'}</Link>}{t.expired&&<span>原件已过期，请核对已保存BOM或重新准备资料。</span>}</li>)}</ul>:<Empty text="暂无整理任务"/>}
  {d.data&&<Pager page={page} size={20} total={d.data.total} onPage={setPage} label="BOM整理任务分页"/>}
 </DataResult></>;
}
