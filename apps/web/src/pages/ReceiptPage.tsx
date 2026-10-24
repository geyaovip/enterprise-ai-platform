import { SourceFlowAction } from './WorkflowsPage';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, erpApi, errorText } from '../api';
import { ConfirmDialog, Empty, Field, Loading, Money, Notice, PageTitle, Pager, ActionPanel, Dialog, DialogAction } from '../components';
import { useApiData } from '../hooks';
import type { Customer, Page } from '../types';

type Claim = { id: string; status: string; amount: string; baseVersion: number; requestedByMembershipId: string; reviewReason: string | null; allocations: Array<{ receivableId: string; contractNumber?: string; amount: string }>; createdAt: string };
type Receipt = { id: string; customerId: string; customer: { name: string }; reference: string; amount: string; allocatedAmount: string; status: string; version: number; receivedAt: string; note: string | null; cancelReason: string | null; claims: Claim[] };
type Claimable = { receipt: { id: string; version: number; reference: string; amount: string; allocatedAmount: string }; accounts: Array<{ id: string; contractNumber: string; remaining: string }> };
type Decision = 'approve' | 'reject' | 'withdraw' | 'cancel';
const statusLabel: Record<string, string> = { open: '待认领', partial: '部分认领', closed: '已认领完毕', cancelled: '已取消', pending: '待财务确认', approved: '已确认', rejected: '已退回', withdrawn: '已撤回' };
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ReceiptPage({ tenantKey, role, membershipId }: { tenantKey: string; role?: string; membershipId?: string }) {
  const [searchParams] = useSearchParams();
  const focus = searchParams.get('focus');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApiData<Page<Receipt>>(erpApi(tenantKey, `/receipts?page=${page}${focus ? `&id=${encodeURIComponent(focus)}` : ''}`));
  const canRegister = role === 'finance' || role === 'admin';
  const canClaim = role === 'sales';
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const customers = useApiData<Page<Customer>>(canRegister ? erpApi(tenantKey, `/customers?page=${customerPage}&page_size=20&q=${encodeURIComponent(customerSearch)}`) : erpApi(tenantKey, '/receipts?page_size=1'));
  const [customerId, setCustomerId] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [receivedAt, setReceivedAt] = useState(localNow);
  const [note, setNote] = useState('');
  const [claimTarget, setClaimTarget] = useState<Receipt | null>(null);
  const [claimable, setClaimable] = useState<Claimable | null>(null);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<Receipt | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const openClaim = async (receipt: Receipt) => {
    setBusy(true); setMessage(null);
    try { setClaimable(await api.get<Claimable>(erpApi(tenantKey, `/receipts/${receipt.id}/claimable`))); setClaimTarget(receipt); setAllocations({}); }
    catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  };
  const register = async () => {
    setBusy(true); setMessage(null);
    try {
      await api.post(erpApi(tenantKey, '/receipts'), { customerId, reference, amount, receivedAt: new Date(receivedAt).toISOString(), note });
      setCustomerId(''); setReference(''); setAmount(''); setNote(''); await reload(); setMessage('到账流水已登记，请销售核对并发起认领。');
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  };
  const claimReceipt = async () => {
    if (!claimTarget || !claimable) return;
    const rows = claimable.accounts.filter(account => Number(allocations[account.id] ?? 0) > 0).map(account => ({ receivableId: account.id, amount: allocations[account.id] }));
    setBusy(true); setMessage(null);
    try { await api.post(erpApi(tenantKey, `/receipts/${claimTarget.id}/claims`), { version: claimable.receipt.version, allocations: rows }); await reload(); setClaimTarget(null); setClaimable(null); setMessage('认领申请已提交，财务确认前不会冲抵应收。'); }
    catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  };
  const act = (receipt: Receipt, next: Decision, item?: Claim) => { setTarget(receipt); setClaim(item ?? null); setDecision(next); setReason(''); };
  const perform = async () => {
    if (!target || !decision) return;
    setBusy(true); setMessage(null);
    try {
      const path = decision === 'cancel' ? `/receipts/${target.id}/cancel` : `/receipts/${target.id}/claims/${claim?.id}/${decision}`;
      await api.post(erpApi(tenantKey, path), { version: target.version, ...(reason.trim() ? { reason } : {}) });
      await reload(); setTarget(null); setClaim(null); setDecision(null); setMessage('到账认领状态已更新。');
    } catch (e) { setMessage(errorText(e)); setDecision(null); }
    finally { setBusy(false); }
  };
  const sum = claimable?.accounts.reduce((total, account) => total + (Number(allocations[account.id]) || 0), 0) ?? 0;
  const available = claimable ? Number(claimable.receipt.amount) - Number(claimable.receipt.allocatedAmount) : 0;
  return <>
    <PageTitle title="到账流水与收款认领"  />
    <Notice text={error} /><Notice text={message} tone={message?.includes('已') ? 'success' : 'error'} />{focus && <p><Link to={`/t/${tenantKey}/erp/receipts`}>返回全部流水</Link></p>}
    <section className="panel table-wrap"><h2>到账流水</h2>{loading ? <Loading /> : !data?.items.length ? <Empty text="当前范围暂无到账流水。" /> : <table><thead><tr><th>流水 / 客户</th><th>到账 / 已分摊</th><th>状态</th><th>认领</th><th>操作</th></tr></thead><tbody>{data.items.map(item => { const pending = item.claims.find(x => x.status === 'pending'); const remaining = Number(item.amount) - Number(item.allocatedAmount); return <tr key={item.id}><td>{item.reference}<small> · {item.customer.name}</small><small> · {new Date(item.receivedAt).toLocaleString('zh-CN')}</small></td><td><Money value={item.amount} /> / <Money value={item.allocatedAmount} /><small> · 未分摊 <Money value={remaining} /></small></td><td>{statusLabel[item.status] ?? item.status}{item.cancelReason && <small> · {item.cancelReason}</small>}</td><td>{item.claims.length ? item.claims.map(x => <div key={x.id}><span>{statusLabel[x.status] ?? x.status} · <Money value={x.amount} /></span>{x.reviewReason && <small> · {x.reviewReason}</small>}{x.status === 'pending' && x.requestedByMembershipId === membershipId && canClaim && <button onClick={() => act(item, 'withdraw', x)}>撤回</button>}{x.status === 'pending' && <SourceFlowAction tenantKey={tenantKey} kind="receipt" id={x.id} version={item.version}>{x.requestedByMembershipId !== membershipId && canRegister && <><button onClick={() => act(item, 'approve', x)}>确认分摊</button><button onClick={() => act(item, 'reject', x)}>退回</button></>}</SourceFlowAction>}</div>) : '—'}</td><td>{canClaim && !pending && remaining > 0 && item.status !== 'cancelled' && <button disabled={busy} onClick={() => void openClaim(item)}>申请认领</button>}{canRegister && item.status === 'open' && !pending && Number(item.allocatedAmount) === 0 && <button onClick={() => act(item, 'cancel')}>取消误登记</button>}</td></tr>; })}</tbody></table>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}</section>
    {canRegister && <ActionPanel title={<>财务登记到账流水</>} label="登记到账流水" busy={busy} successKey={message?.startsWith("到账流水已登记") ? message : null} error={message?.includes("已") ? null : message}><section className="form-panel"><Field label="查找客户"><input value={customerSearch} onChange={e => { setCustomerSearch(e.target.value); setCustomerPage(1); }} placeholder="输入名称或编号" /></Field><div className="form-grid"><Field label="客户"><select value={customerId} onChange={e => setCustomerId(e.target.value)}><option value="">请选择</option>{customers.data?.items.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field><Field label="银行流水号"><input maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></Field><Field label="到账金额（元）"><input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field><Field label="到账时间"><input type="datetime-local" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} /></Field></div><Field label="备注"><textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></Field><DialogAction><button className="primary" disabled={busy || !customerId || !reference.trim() || Number(amount) <= 0 || !receivedAt} onClick={() => void register()}>登记到账</button></DialogAction>{customers.data && <Pager page={customerPage} total={customers.data.total} size={customers.data.page_size} onPage={setCustomerPage} />}</section></ActionPanel>}
    {claimTarget && claimable && <Dialog open title={<>申请认领 · {claimTarget.reference}</>} onClose={() => {setClaimTarget(null);setClaimable(null);}} busy={busy} dirtyCheck size="large"><Notice text={message?.includes("已") ? null : message} /><section className="form-panel"><p>本流水尚余 <Money value={available} />。只能分摊到当前负责客户的应收；财务确认前不记收款。</p>{claimable.accounts.length ? <div className="form-grid">{claimable.accounts.map(account => <Field key={account.id} label={`${account.contractNumber} · 应收未结 ${account.remaining} 元`}><input type="number" min="0" max={account.remaining} step="0.01" value={allocations[account.id] ?? ''} onChange={e => setAllocations(previous => ({ ...previous, [account.id]: e.target.value }))} /></Field>)}</div> : <Empty text="这个客户当前没有可分摊的应收。" />}<p>本次认领合计：<Money value={sum} /></p><div className="form-actions"><DialogAction><button className="primary" disabled={busy || sum <= 0 || sum > available || claimable.accounts.some(account => Number(allocations[account.id] ?? 0) > Number(account.remaining))} onClick={() => void claimReceipt()}>提交财务确认</button></DialogAction><button onClick={() => { setClaimTarget(null); setClaimable(null); }}>取消</button></div></section></Dialog>}
    {target && decision && <ConfirmDialog error={message} open title={decision === 'approve' ? '确认收款分摊' : decision === 'reject' ? '退回收款认领' : decision === 'withdraw' ? '撤回认领申请' : '取消误登记流水'} description={<div><p>{target.reference} · {claim ? <Money value={claim.amount} /> : <Money value={target.amount} />}。确认分摊会更新应收余额并生成收款回执。</p>{claim && decision === 'approve' && <ul>{claim.allocations.map(row => <li key={row.receivableId}>{row.contractNumber ?? `应收 ${row.receivableId.slice(0, 8)}`}：{row.amount} 元</li>)}</ul>}{['reject', 'cancel'].includes(decision) && <Field label="原因"><textarea maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>}</div>} busy={busy} confirmDisabled={['reject', 'cancel'].includes(decision) && !reason.trim()} onCancel={() => { setTarget(null); setClaim(null); setDecision(null); }} onConfirm={() => void perform()} />}
  </>;
}
