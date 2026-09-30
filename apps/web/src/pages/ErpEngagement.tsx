import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, erpApi, errorText } from '../api';
import { Empty, Field, Loading, Notice, Pager } from '../components';
import { useApiData } from '../hooks';
import type { Customer, Opportunity, OpportunityFollowup, Page } from '../types';

export function CustomerPoolPanel({ tenantKey, role, onClaim }: { tenantKey: string; role?: string; onClaim: () => Promise<unknown> }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useApiData<Page<Customer>>(erpApi(tenantKey, `/customers/pool?page=${page}&q=${encodeURIComponent(query)}`));
  const [form, setForm] = useState({ code: '', name: '', contactName: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      await api.post(erpApi(tenantKey, '/customers'), { ...form, inPool: true });
      setForm({ code: '', name: '', contactName: '', phone: '' });
      await reload(); setMessage('公海客户已添加');
    } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); }
  };
  const claim = async (id: string) => {
    setBusy(true); setMessage(null);
    try { await api.post(erpApi(tenantKey, `/customers/${id}/claim`), {}); await Promise.all([reload(), onClaim()]); setMessage('客户已领用'); }
    catch (e) { await reload(); setMessage(errorText(e)); }
    finally { setBusy(false); }
  };
  return <section className="panel table-wrap"><h2>客户公海</h2><p>管理员添加未分配客户；销售领用成功后，该客户进入自己的列表。并发领用只允许一人成功。</p><Notice text={error} /><Notice text={message} tone={message?.includes('已') ? 'success' : 'error'} /><div className="toolbar"><form onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search); }}><input aria-label="搜索公海客户" value={search} placeholder="搜索名称或编号" onChange={event => setSearch(event.target.value)} /><button>搜索</button></form></div>{loading ? <Loading /> : !data?.items.length ? <Empty text="暂无待领用客户。" /> : <table><thead><tr><th>编号</th><th>客户</th><th>联系人</th><th>操作</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{item.contactName || '—'}</td><td><button type="button" disabled={busy} onClick={() => void claim(item.id)}>领用</button></td></tr>)}</tbody></table>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}{role === 'admin' && <form className="form-panel" onSubmit={create}><h3>添加公海客户</h3><div className="form-grid"><Field label="客户编号"><input required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></Field><Field label="名称"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="联系人"><input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} /></Field><Field label="电话"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field></div><button className="primary" disabled={busy}>添加到公海</button></form>}</section>;
}

export function OpportunityFollowupPanel({ tenantKey, opportunity, canWrite }: { tenantKey: string; opportunity: Opportunity; canWrite: boolean }) {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApiData<Page<OpportunityFollowup>>(erpApi(tenantKey, `/opportunities/${opportunity.id}/followups?page=${page}`));
  const [note, setNote] = useState('');
  const [nextActionAt, setNextActionAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      await api.post(erpApi(tenantKey, `/opportunities/${opportunity.id}/followups`), { note, ...(nextActionAt ? { nextActionAt: new Date(nextActionAt).toISOString() } : {}) });
      setNote(''); setNextActionAt(''); setPage(1); await reload(); setMessage('跟进已记录');
    } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); }
  };
  return <section className="panel"><h2>商机跟进 · {opportunity.name}</h2><p>记录事实与下一次处理时间；时间仅作为业务记录，自动提醒尚未接入。</p><Notice text={error} /><Notice text={message} tone={message === '跟进已记录' ? 'success' : 'error'} />{canWrite && <form className="form-panel" onSubmit={save}><Field label="跟进记录"><textarea required minLength={1} maxLength={2000} rows={3} value={note} onChange={e => setNote(e.target.value)} /></Field><Field label="下次跟进时间（可选）"><input type="datetime-local" value={nextActionAt} onChange={e => setNextActionAt(e.target.value)} /></Field><button className="primary" disabled={busy}>保存跟进</button></form>}{loading ? <Loading /> : !data?.items.length ? <Empty text="暂无跟进记录。" /> : <ul className="simple-list">{data.items.map(item => <li key={item.id}><div><strong>{item.actorName}</strong> · {new Date(item.createdAt).toLocaleString('zh-CN')}<p>{item.note}</p>{item.nextActionAt && <small>下次跟进：{new Date(item.nextActionAt).toLocaleString('zh-CN')}</small>}</div></li>)}</ul>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}</section>;
}
