import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, erpApi, errorText } from '../api';
import { ConfirmDialog, Empty, Field, Loading, Money, Notice, PageTitle, Pager, Status } from '../components';
import { useApiData } from '../hooks';
import type { Account, Balance, InventoryAlert, Page, StockDocument, StockMovement } from '../types';

type Props = { tenantKey: string; role?: string };

export function InventoryPage({ tenantKey, role }: Props) {
  const base = erpApi(tenantKey, '/inventory');
  const [tab, setTab] = useState<'alerts' | 'balances' | 'documents' | 'movements'>('alerts');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const alerts = useApiData<Page<InventoryAlert>>(`${base}/alerts?page=${page}&status=${showResolved ? 'all' : 'active'}`);
  const balances = useApiData<Page<Balance>>(`${base}?page=${page}&q=${encodeURIComponent(query)}`);
  const documents = useApiData<Page<StockDocument>>(`${base}/documents?page=${page}`);
  const movements = useApiData<Page<StockMovement>>(`${base}/movements?page=${page}`);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canWrite = role === 'admin' || role === 'warehouse';
  const selected = balances.data?.items.filter(x => counts[x.productId] !== undefined) ?? [];
  const perform = async () => {
    setBusy(true); setMessage(null);
    try {
      await api.post(`${base}/stocktakes`, { documentNumber: number, note, lines: selected.map(x => ({ productId: x.productId, countedQty: counts[x.productId], version: x.version })) });
      setPending(false); setCounts({}); setNumber(''); setNote('');
      await Promise.all([alerts.reload(), balances.reload(), documents.reload(), movements.reload()]);
      setMessage('盘点已入账，库存与流水已更新。');
    } catch (e) { setMessage(errorText(e)); setPending(false); }
    finally { setBusy(false); }
  };
  return <><PageTitle title="库存与预警" subtitle="低库存由商品阈值和实时库存计算；采购在途不等于已入库。盘点以当前版本提交。" /><Notice text={message} tone={message?.startsWith('盘点已') ? 'success' : 'error'} /><div className="tabs" role="tablist" aria-label="库存视图">{([['alerts', '低库存待办'], ['balances', '库存余额'], ['documents', '出入库单'], ['movements', '库存流水']] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} key={id} onClick={() => { setTab(id); setPage(1); setCounts({}); }}>{label}</button>)}</div>
    {tab === 'alerts' && <><div className="toolbar"><label><input type="checkbox" checked={showResolved} onChange={e => { setShowResolved(e.target.checked); setPage(1); }} /> 显示库存正常商品</label><button type="button" onClick={() => void alerts.reload()}>刷新当前状态</button></div><Notice text={alerts.error} /><section className="panel table-wrap"><h2>低库存处理</h2><p>只对启用且设置了正数阈值的商品预警；状态随库存、阈值及已确认采购单实时计算。草稿不计入在途量。</p>{alerts.loading ? <Loading /> : !alerts.data?.items.length ? <Empty text={showResolved ? '暂无设置阈值的商品。' : '当前没有低库存待办。'} /> : <table><thead><tr><th>商品</th><th>现存 / 阈值</th><th>已确认待入库</th><th>建议新增采购</th><th>状态与依据</th><th>处理</th></tr></thead><tbody>{alerts.data.items.map(x => <tr key={x.productId}><td>{x.sku} · {x.name}</td><td>{x.quantity} / {x.reorderPoint} 件</td><td>{x.incomingQty} 件 {x.pendingOrders.map(order => <div key={order.id}><Link to={`/t/${tenantKey}/erp/purchases/${order.id}`}>{order.number}</Link> 尚余 {order.remainingQty} 件</div>)}</td><td>{x.suggestedOrderQty} 件</td><td><Status value={x.status} />{x.latestReceipt && <div><small>最近入库：{x.latestReceipt.documentNumber} · {x.latestReceipt.quantity} 件 · <Link to={`/t/${tenantKey}/erp/purchases/${x.latestReceipt.purchaseId}`}>{x.latestReceipt.purchaseNumber}</Link></small></div>}</td><td>{x.status === 'needs_purchase' && ['admin', 'purchasing'].includes(role ?? '') && (x.suggestedOrderQty > 1_000_000_000 ? <span>建议量超出单行上限，请分单处理</span> : <Link to={`/t/${tenantKey}/erp/purchases?productId=${encodeURIComponent(x.productId)}&sku=${encodeURIComponent(x.sku)}&quantity=${x.suggestedOrderQty}&balanceVersion=${x.balanceVersion}&reorderPoint=${x.reorderPoint}&incomingQty=${x.incomingQty}`}>带入采购草稿</Link>)}{x.status === 'awaiting_receipt' && <span>等待入库回执</span>}{x.status === 'normal' && <span>库存已高于阈值</span>}</td></tr>)}</tbody></table>}{alerts.data && <Pager page={page} total={alerts.data.total} size={alerts.data.page_size} onPage={setPage} />}</section></>}
    {tab === 'balances' && <><Notice text={balances.error} /><div className="toolbar"><form onSubmit={e => { e.preventDefault(); setPage(1); setCounts({}); setQuery(search); }}><input aria-label="搜索库存" placeholder="搜索 SKU 或商品名称" value={search} onChange={e => setSearch(e.target.value)} /><button>搜索</button></form></div><section className="panel table-wrap">{balances.loading ? <Loading /> : !balances.data?.items.length ? <Empty text="暂无库存余额，请先完成采购入库。" /> : <table><thead><tr><th>SKU</th><th>商品</th><th>现存</th><th>预警阈值</th><th>版本</th>{canWrite && <th>本次盘点数量</th>}</tr></thead><tbody>{balances.data.items.map(x => <tr key={x.id}><td>{x.product?.sku}</td><td>{x.product?.name}</td><td>{x.quantity} 件 {x.lowStock && <Status value="low_stock" />}</td><td>{x.product?.reorderPoint ?? 0} 件</td><td>{x.version}</td>{canWrite && <td><input aria-label={`盘点 ${x.product?.name}`} type="number" min="0" placeholder="不盘点" value={counts[x.productId] ?? ''} onChange={e => setCounts(old => { const next = { ...old }; if (e.target.value === '') delete next[x.productId]; else next[x.productId] = Number(e.target.value); return next; })} /></td>}</tr>)}</tbody></table>}{balances.data && <Pager page={page} total={balances.data.total} size={balances.data.page_size} onPage={next => { setCounts({}); setPage(next); }} />}</section>{canWrite && <section className="panel form-panel"><h2>库存盘点</h2><p>只处理填写了数量的商品。提交后会生成盘点单和差额流水。</p><div className="form-grid"><Field label="盘点单号"><input required value={number} onChange={e => setNumber(e.target.value)} /></Field><Field label="备注"><input value={note} onChange={e => setNote(e.target.value)} /></Field></div><button className="primary" disabled={!selected.length || !number.trim() || busy || selected.some(x => !Number.isInteger(counts[x.productId]) || counts[x.productId] < 0)} onClick={() => setPending(true)}>预览并提交盘点</button></section>}</>}
    {tab === 'documents' && <><Notice text={documents.error} /><section className="panel table-wrap">{documents.loading ? <Loading /> : !documents.data?.items.length ? <Empty /> : <table><thead><tr><th>单号</th><th>类型</th><th>发生时间</th><th>流水</th></tr></thead><tbody>{documents.data.items.map(x => <tr key={x.id}><td>{x.number}</td><td><Status value={x.kind} /></td><td>{new Date(x.createdAt).toLocaleString('zh-CN')}</td><td>{x.movements.map(m => `${m.product?.sku ?? m.productId} ${m.direction === 'in' ? '+' : '-'}${m.quantity}`).join('、') || '无数量差额'}</td></tr>)}</tbody></table>}{documents.data && <Pager page={page} total={documents.data.total} size={documents.data.page_size} onPage={setPage} />}</section></>}
    {tab === 'movements' && <><Notice text={movements.error} /><section className="panel table-wrap">{movements.loading ? <Loading /> : !movements.data?.items.length ? <Empty /> : <table><thead><tr><th>时间</th><th>商品</th><th>方向</th><th>数量</th><th>来源</th></tr></thead><tbody>{movements.data.items.map(x => <tr key={x.id}><td>{new Date(x.createdAt).toLocaleString('zh-CN')}</td><td>{x.product ? `${x.product.sku} · ${x.product.name}` : x.productId}</td><td>{x.direction === 'in' ? '入库' : '出库'}</td><td>{x.quantity} 件</td><td>{x.sourceType}</td></tr>)}</tbody></table>}{movements.data && <Pager page={page} total={movements.data.total} size={movements.data.page_size} onPage={setPage} />}</section></>}
    <ConfirmDialog open={pending} title="确认库存盘点" description={<div><p>盘点单号：{number}</p>{selected.map(x => <p key={x.id}>{x.product?.sku}：{x.quantity} → {counts[x.productId]} 件</p>)}</div>} busy={busy} onCancel={() => setPending(false)} onConfirm={() => void perform()} />
  </>;
}

export function FinancePage({ tenantKey, role }: Props) {
  const [kind, setKind] = useState<'receivables' | 'payables'>('receivables');
  const [page, setPage] = useState(1);
  const path = erpApi(tenantKey, `/finance/${kind}?page=${page}`);
  const { data, loading, error, reload } = useApiData<Page<Account>>(path);
  const [target, setTarget] = useState<Account | null>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canWrite = role === 'admin' || role === 'finance';
  const submit = (e: FormEvent) => { e.preventDefault(); setPending(true); };
  const perform = async () => {
    if (!target) return;
    setBusy(true); setMessage(null);
    try { await api.post(erpApi(tenantKey, `/finance/${kind}/${target.id}/payments`), { amount, reference }); await reload(); setTarget(null); setPending(false); setAmount(''); setReference(''); setMessage('收付款已登记。'); }
    catch (e) { setMessage(errorText(e)); setPending(false); }
    finally { setBusy(false); }
  };
  return <><PageTitle title="应收应付" subtitle="按已出入库的业务金额形成账款；收付款只登记真实业务回执。" /><Notice text={error} /><Notice text={message} tone={message === '收付款已登记。' ? 'success' : 'error'} /><div className="tabs" role="tablist" aria-label="账款类型"><button role="tab" aria-selected={kind === 'receivables'} className={kind === 'receivables' ? 'active' : ''} onClick={() => { setKind('receivables'); setPage(1); setTarget(null); }}>应收</button><button role="tab" aria-selected={kind === 'payables'} className={kind === 'payables' ? 'active' : ''} onClick={() => { setKind('payables'); setPage(1); setTarget(null); }}>应付</button></div><section className="panel table-wrap">{loading ? <Loading /> : !data?.items.length ? <Empty text="暂无账款。" /> : <table><thead><tr><th>来源单据</th><th>应收/应付</th><th>已收/已付</th><th>未结余额</th><th>状态</th><th>记录</th></tr></thead><tbody>{data.items.map(x => <tr key={x.id}><td>{x.contract?.number ?? x.order?.number ?? '—'}</td><td><Money value={x.amount} /></td><td><Money value={x.paidAmount} /></td><td><Money value={Math.max(0, Number(x.amount) - Number(x.paidAmount))} /></td><td><Status value={x.status} /></td><td><div className="account-actions">{canWrite && x.status !== 'paid' && <button onClick={() => { setTarget(x); setAmount((Number(x.amount) - Number(x.paidAmount)).toFixed(2)); setReference(''); }}>登记{kind === 'receivables' ? '收款' : '付款'}</button>}{x.payments?.length ? <details><summary>查看 {x.payments.length} 笔记录</summary><ul className="payment-history">{x.payments.map(payment => <li key={payment.id}><span>{new Date(payment.createdAt).toLocaleString('zh-CN')}</span><strong><Money value={payment.amount} /></strong><span>流水号 {payment.reference}</span></li>)}</ul></details> : <span>暂无记录</span>}</div></td></tr>)}</tbody></table>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}</section>{target && <form className="panel form-panel" onSubmit={submit}><h2>登记{kind === 'receivables' ? '收款' : '付款'} · {target.contract?.number ?? target.order?.number}</h2><p>剩余 <Money value={Math.max(0, Number(target.amount) - Number(target.paidAmount))} /></p><div className="form-grid"><Field label="金额（CNY）"><input required type="number" min="0.01" step="0.01" max={(Number(target.amount) - Number(target.paidAmount)).toFixed(2)} value={amount} onChange={e => setAmount(e.target.value)} /></Field><Field label="业务流水号"><input required value={reference} onChange={e => setReference(e.target.value)} /></Field></div><div className="form-actions"><button className="primary" disabled={busy}>核对后登记</button><button type="button" onClick={() => setTarget(null)}>取消</button></div></form>}<ConfirmDialog open={pending} title="确认登记收付款" description={<p>{target?.contract?.number ?? target?.order?.number} · <Money value={amount || 0} /> · 流水号 {reference}</p>} busy={busy} onCancel={() => setPending(false)} onConfirm={() => void perform()} /></>;
}
