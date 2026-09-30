import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, erpApi, errorText } from '../api';
import { Empty, Field, Loading, Money, Notice, PageTitle, Pager, Status } from '../components';
import { useApiData } from '../hooks';
import type { Customer, Opportunity, Page, Product, Supplier } from '../types';
import { CustomerPoolPanel, OpportunityFollowupPanel } from './ErpEngagement';

type Props = { tenantKey: string; role?: string };
const link = (key: string, path: string) => `/t/${key}/erp${path}`;

export function DashboardPage({ tenantKey }: Props) {
  const { data, loading, error } = useApiData<{ customers: number; activeOpportunities: number; purchasesToReceive: number | null; contractsToShip: number | null; activeProducts: number; receivableBalance: string | null; payableBalance: string | null }>(erpApi(tenantKey, '/dashboard'));
  return <><PageTitle title="经营概览" subtitle="指标来自当前企业的业务记录。" /><Notice text={error} />{loading ? <Loading /> : data ? <div className="metric-grid">{[
    ['客户', data.customers, '/customers'], ['进行中商机', data.activeOpportunities, '/opportunities'], ['待入库采购', data.purchasesToReceive, '/purchases'], ['待出库合同', data.contractsToShip, '/contracts'], ['在用商品', data.activeProducts, '/products'], ['应收余额', data.receivableBalance === null ? null : `¥${data.receivableBalance}`, '/finance'], ['应付余额', data.payableBalance === null ? null : `¥${data.payableBalance}`, '/finance'],
  ].filter(x => x[1] !== null).map(([title, value, path]) => <Link className="metric" key={String(title)} to={link(tenantKey, String(path))}><span>{title}</span><strong>{value}</strong></Link>)}</div> : null}</>;
}

export function CustomerPage({ tenantKey, role }: Props) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ code: '', name: '', contactName: '', phone: '', industry: '', active: true });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = erpApi(tenantKey, `/customers?page=${page}&q=${encodeURIComponent(query)}`);
  const { data, loading, error, reload } = useApiData<Page<Customer>>(path);
  const canWrite = role === 'admin' || role === 'sales';
  const select = (item: Customer) => { setEditing(item); setForm({ code: item.code, name: item.name, contactName: item.contactName ?? '', phone: item.phone ?? '', industry: item.industry ?? '', active: item.active }); setMessage(null); };
  const reset = () => { setEditing(null); setForm({ code: '', name: '', contactName: '', phone: '', industry: '', active: true }); };
  const save = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setMessage(null); try { if (editing) await api.patch(erpApi(tenantKey, `/customers/${editing.id}`), { name: form.name, contactName: form.contactName, phone: form.phone, industry: form.industry, active: form.active }); else await api.post(erpApi(tenantKey, '/customers'), form); reset(); await reload(); setMessage('客户已保存'); } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); } };
  return <><PageTitle title="客户" subtitle="客户编号在当前企业内唯一；销售只看到自己负责的记录。" /><Notice text={message} tone={message === '客户已保存' ? 'success' : 'error'} /><Notice text={error} /><div className="toolbar"><form onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search); }}><input aria-label="搜索客户" placeholder="搜索客户名称或编号" value={search} onChange={e => setSearch(e.target.value)} /><button>搜索</button></form></div><div className="panel table-wrap">{loading ? <Loading /> : !data?.items.length ? <Empty text="当前范围暂无客户。" /> : <table><thead><tr><th>编号</th><th>客户</th><th>联系人</th><th>电话</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{item.contactName || '—'}</td><td>{item.phone || '—'}</td><td><Status value={item.active ? 'active' : 'inactive'} /></td><td>{canWrite && <button onClick={() => select(item)}>编辑</button>} <Link to={`/t/${tenantKey}/ai?type=customer&id=${item.id}`}>AI 分析</Link></td></tr>)}</tbody></table>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}</div>{canWrite && <CustomerPoolPanel tenantKey={tenantKey} role={role} onClaim={reload} />}{canWrite && <form className="panel form-panel" onSubmit={save}><h2>{editing ? `编辑客户 · ${editing.code}` : '新建客户'}</h2><div className="form-grid">{!editing && <Field label="客户编号"><input required maxLength={60} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></Field>}<Field label="名称"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="联系人"><input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} /></Field><Field label="电话"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field><Field label="行业"><input value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} /></Field>{editing && <Field label="状态"><select value={String(form.active)} onChange={e => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">启用</option><option value="false">停用</option></select></Field>}</div><div className="form-actions"><button className="primary" disabled={busy}>{busy ? '保存中…' : '保存客户'}</button>{editing && <button type="button" onClick={reset}>取消编辑</button>}</div></form>}</>;
}

export function OpportunityPage({ tenantKey, role }: Props) {
  const [selectedFollowup, setSelectedFollowup] = useState<Opportunity | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const { data, loading, error, reload } = useApiData<Page<Opportunity>>(erpApi(tenantKey, `/opportunities?page=${page}&q=${encodeURIComponent(query)}`));
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const customers = useApiData<Page<Customer>>(erpApi(tenantKey, `/customers?page=${customerPage}&page_size=20&q=${encodeURIComponent(customerSearch)}`));
  const [customerId, setCustomerId] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('0.00');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canWrite = role === 'admin' || role === 'sales';
  const customerOptions = [
    ...(selectedCustomer?.id === customerId ? [selectedCustomer] : []),
    ...(customers.data?.items ?? []),
  ].filter((item, index, all) => item.active && all.findIndex(other => other.id === item.id) === index);
  const chooseCustomer = (id: string) => {
    setCustomerId(id);
    setSelectedCustomer(customerOptions.find(item => item.id === id) ?? null);
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      await api.post(erpApi(tenantKey, '/opportunities'), { customerId, name, estimatedAmount: amount });
      setName(''); await reload(); setMessage('商机已创建');
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  };
  const change = async (id: string, stage: string) => {
    setBusy(true);
    try { await api.post(erpApi(tenantKey, `/opportunities/${id}/stage`), { stage }); await reload(); setMessage('阶段已更新'); }
    catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  };
  return <>
    <PageTitle title="商机" subtitle="ERP 首期商机由 ERP 模块拥有。" /><Notice text={error} /><Notice text={message} tone={message?.includes('已') ? 'success' : 'error'} />
    <div className="toolbar"><form onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search); }}><input aria-label="搜索商机" placeholder="搜索商机名称" value={search} onChange={event => setSearch(event.target.value)} /><button>搜索</button></form></div>
    <div className="panel table-wrap">{loading ? <Loading /> : !data?.items.length ? <Empty text="暂无商机。" /> : <table><thead><tr><th>商机</th><th>客户</th><th>阶段</th><th>预计金额</th><th>操作</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.customer?.name}</td><td><Status value={item.stage} /></td><td><Money value={item.estimatedAmount} /></td><td><button type="button" onClick={() => setSelectedFollowup(item)}>跟进记录</button> {canWrite && !['won', 'lost'].includes(item.stage) && <select aria-label={`修改 ${item.name} 阶段`} disabled={busy} value={item.stage} onChange={event => void change(item.id, event.target.value)}><option value="discovery">发现</option><option value="proposal">方案</option><option value="won">赢单</option><option value="lost">输单</option></select>}</td></tr>)}</tbody></table>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}</div>
    {selectedFollowup && <OpportunityFollowupPanel key={selectedFollowup.id} tenantKey={tenantKey} opportunity={selectedFollowup} canWrite={canWrite} />}
    {canWrite && <form className="panel form-panel" onSubmit={create}><h2>新建商机</h2><Field label="查找客户"><input value={customerSearch} placeholder="输入客户名称或编号" onChange={event => { setCustomerSearch(event.target.value); setCustomerPage(1); }} /></Field><div className="form-grid"><Field label="客户"><select required value={customerId} onChange={event => chooseCustomer(event.target.value)}><option value="">请选择</option>{customerOptions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field><Field label="名称"><input required value={name} onChange={event => setName(event.target.value)} /></Field><Field label="预计金额（CNY）"><input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field></div>{customers.error && <Notice text={customers.error} />}{customers.data && <Pager page={customerPage} total={customers.data.total} size={customers.data.page_size} onPage={setCustomerPage} />}<button className="primary" disabled={busy}>创建商机</button></form>}
  </>;
}

export function ProductPage({ tenantKey, role }: Props) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const { data, loading, error, reload } = useApiData<Page<Product>>(erpApi(tenantKey, `/products?page=${page}&q=${encodeURIComponent(query)}`));
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ sku: '', name: '', category: '', salePrice: '0.00', purchasePrice: '0.00', reorderPoint: 0, active: true });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = role === 'admin' || role === 'purchasing';
  const select = (x: Product) => { setEditing(x); setForm({ sku: x.sku, name: x.name, category: x.category ?? '', salePrice: x.salePrice, purchasePrice: x.purchasePrice, reorderPoint: x.reorderPoint, active: x.active }); };
  const reset = () => { setEditing(null); setForm({ sku: '', name: '', category: '', salePrice: '0.00', purchasePrice: '0.00', reorderPoint: 0, active: true }); };
  const save = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setMessage(null); try { if (editing) await api.patch(erpApi(tenantKey, `/products/${editing.id}`), form); else await api.post(erpApi(tenantKey, '/products'), form); reset(); await reload(); setMessage('商品已保存'); } catch (x) { setMessage(errorText(x)); } finally { setBusy(false); } };
  return <><PageTitle title="商品" subtitle="价格按 CNY 两位小数；停用后保留历史记录。" /><Notice text={error} /><Notice text={message} tone={message === '商品已保存' ? 'success' : 'error'} /><div className="toolbar"><form onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search); }}><input aria-label="搜索商品" placeholder="搜索 SKU 或商品名称" value={search} onChange={e => setSearch(e.target.value)} /><button>搜索</button></form></div><div className="panel table-wrap">{loading ? <Loading /> : !data?.items.length ? <Empty text="暂无商品。" /> : <table><thead><tr><th>SKU</th><th>商品</th><th>售价</th><th>采购价</th><th>库存</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.items.map(x => <tr key={x.id}><td>{x.sku}</td><td>{x.name}</td><td><Money value={x.salePrice} /></td><td><Money value={x.purchasePrice} /></td><td>{x.balance?.quantity ?? 0} 件</td><td><Status value={x.active ? 'active' : 'inactive'} /></td><td>{canWrite && <button onClick={() => select(x)}>编辑</button>}</td></tr>)}</tbody></table>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}</div>{canWrite && <form className="panel form-panel" onSubmit={save}><h2>{editing ? `编辑商品 · ${editing.sku}` : '新建商品'}</h2><div className="form-grid">{!editing && <Field label="SKU"><input required value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></Field>}<Field label="名称"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="类别"><input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></Field><Field label="售价（CNY）"><input required inputMode="decimal" value={form.salePrice} onChange={e => setForm({ ...form, salePrice: e.target.value })} /></Field><Field label="采购价（CNY）"><input required inputMode="decimal" value={form.purchasePrice} onChange={e => setForm({ ...form, purchasePrice: e.target.value })} /></Field><Field label="低库存阈值（件）"><input type="number" min="0" required value={form.reorderPoint} onChange={e => setForm({ ...form, reorderPoint: Number(e.target.value) })} /></Field>{editing && <Field label="状态"><select value={String(form.active)} onChange={e => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">启用</option><option value="false">停用</option></select></Field>}</div><div className="form-actions"><button className="primary" disabled={busy}>保存商品</button>{editing && <button type="button" onClick={reset}>取消编辑</button>}</div></form>}</>;
}

export function SupplierPage({ tenantKey, role }: Props) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const { data, loading, error, reload } = useApiData<Page<Supplier>>(erpApi(tenantKey, `/suppliers?page=${page}&q=${encodeURIComponent(query)}`));
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ code: '', name: '', contactName: '', phone: '', active: true });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = role === 'admin' || role === 'purchasing';
  const select = (x: Supplier) => { setEditing(x); setForm({ code: x.code, name: x.name, contactName: x.contactName ?? '', phone: x.phone ?? '', active: x.active }); };
  const reset = () => { setEditing(null); setForm({ code: '', name: '', contactName: '', phone: '', active: true }); };
  const save = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setMessage(null); try { if (editing) await api.patch(erpApi(tenantKey, `/suppliers/${editing.id}`), form); else await api.post(erpApi(tenantKey, '/suppliers'), form); reset(); await reload(); setMessage('供应商已保存'); } catch (x) { setMessage(errorText(x)); } finally { setBusy(false); } };
  return <><PageTitle title="供应商" subtitle="采购单只能引用启用中的供应商。" /><Notice text={error} /><Notice text={message} tone={message === '供应商已保存' ? 'success' : 'error'} /><div className="toolbar"><form onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search); }}><input aria-label="搜索供应商" placeholder="搜索供应商名称或编号" value={search} onChange={e => setSearch(e.target.value)} /><button>搜索</button></form></div><div className="panel table-wrap">{loading ? <Loading /> : !data?.items.length ? <Empty text="暂无供应商。" /> : <table><thead><tr><th>编号</th><th>供应商</th><th>联系人</th><th>电话</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.items.map(x => <tr key={x.id}><td>{x.code}</td><td>{x.name}</td><td>{x.contactName || '—'}</td><td>{x.phone || '—'}</td><td><Status value={x.active ? 'active' : 'inactive'} /></td><td>{canWrite && <button onClick={() => select(x)}>编辑</button>}</td></tr>)}</tbody></table>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}</div>{canWrite && <form className="panel form-panel" onSubmit={save}><h2>{editing ? `编辑供应商 · ${editing.code}` : '新建供应商'}</h2><div className="form-grid">{!editing && <Field label="编号"><input required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></Field>}<Field label="名称"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="联系人"><input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} /></Field><Field label="电话"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>{editing && <Field label="状态"><select value={String(form.active)} onChange={e => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">启用</option><option value="false">停用</option></select></Field>}</div><div className="form-actions"><button className="primary" disabled={busy}>保存供应商</button>{editing && <button type="button" onClick={reset}>取消编辑</button>}</div></form>}</>;
}
