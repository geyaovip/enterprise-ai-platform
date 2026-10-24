import { SourceFlowAction } from './WorkflowsPage';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, erpApi, errorText } from '../api';
import { ConfirmDialog, Empty, Field, Loading, Money, Notice, PageTitle, Pager, ActionPanel, DialogAction } from '../components';
import { useApiData } from '../hooks';
import type { Contract, Page } from '../types';

type Invoice = {
  id: string;
  contractId: string;
  contract: { number: string; customer: { name: string } };
  amount: string;
  status: string;
  note: string | null;
  invoiceNumber: string | null;
  requestedByMembershipId: string;
  reviewReason: string | null;
  voidReference: string | null;
  createdAt: string;
  registeredAt: string | null;
};

const labels: Record<string, string> = { requested: '待财务处理', registered: '已内部登记', rejected: '已退回', withdrawn: '已撤回', voided: '登记已标作废' };
type Decision = 'register' | 'reject' | 'withdraw' | 'void';

export function InvoicePage({ tenantKey, role, membershipId }: { tenantKey: string; role?: string; membershipId?: string }) {
  const [searchParams] = useSearchParams();
  const focus = searchParams.get('focus');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApiData<Page<Invoice>>(erpApi(tenantKey, `/invoices?page=${page}${focus ? `&id=${encodeURIComponent(focus)}` : ''}`));
  const canRequest = role === 'admin' || role === 'sales';
  const canReview = role === 'admin' || role === 'finance';
  const [search, setSearch] = useState('');
  const [contractPage, setContractPage] = useState(1);
  const contracts = useApiData<Page<Contract>>(canRequest ? erpApi(tenantKey, `/contracts?page=${contractPage}&page_size=20&q=${encodeURIComponent(search)}`) : erpApi(tenantKey, '/invoices?page_size=1'));
  const [contractId, setContractId] = useState('');
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<Invoice | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [reason, setReason] = useState('');
  const [voidReference, setVoidReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const eligibleContracts = [selectedContract, ...(contracts.data?.items ?? [])].filter((item): item is Contract => Boolean(item && ['confirmed', 'partial_shipped', 'shipped'].includes(item.status))).filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
  const request = async () => {
    setBusy(true); setMessage(null);
    try {
      await api.post(erpApi(tenantKey, '/invoices'), { contractId, contractVersion: selectedContract?.version, amount, note });
      setContractId(''); setSelectedContract(null); setAmount(''); setNote(''); await Promise.all([reload(), contracts.reload()]);
      setMessage('内部开票申请已提交。');
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  };
  const perform = async () => {
    if (!target || !decision) return;
    setBusy(true); setMessage(null);
    try {
      const body = decision === 'register' ? { invoiceNumber } : decision === 'void' ? { reason, voidReference } : decision === 'reject' ? { reason } : {};
      await api.post(erpApi(tenantKey, `/invoices/${target.id}/${decision}`), body);
      await reload(); setTarget(null); setDecision(null); setInvoiceNumber(''); setReason(''); setVoidReference('');
      setMessage('内部开票状态已更新。');
    } catch (e) { setMessage(errorText(e)); setDecision(null); }
    finally { setBusy(false); }
  };
  const act = (item: Invoice, action: Decision) => { setTarget(item); setDecision(action); setInvoiceNumber(''); setReason(''); setVoidReference(''); };
  const actionReady = decision === 'register' ? Boolean(invoiceNumber.trim()) : decision === 'reject' ? Boolean(reason.trim()) : decision === 'void' ? Boolean(reason.trim() && voidReference.trim()) : true;
  return <>
    <PageTitle title="开票申请与登记"  />
    <Notice text={error} /><Notice text={message} tone={message?.includes('已') ? 'success' : 'error'} />{focus && <p><Link to={`/t/${tenantKey}/erp/invoices`}>返回全部申请</Link></p>}
    <section className="panel table-wrap"><h2>申请记录</h2>{loading ? <Loading /> : !data?.items.length ? <Empty text="暂无内部开票申请。" /> : <table><thead><tr><th>合同 / 客户</th><th>申请金额</th><th>状态</th><th>登记编号</th><th>操作</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td><Link to={`/t/${tenantKey}/erp/contracts/${item.contractId}`}>{item.contract.number}</Link><small> · {item.contract.customer.name}</small></td><td><Money value={item.amount} /></td><td>{labels[item.status] ?? item.status}{item.reviewReason && <small> · {item.reviewReason}</small>}{item.voidReference && <small> · 作废凭据 {item.voidReference}</small>}</td><td>{item.invoiceNumber ?? '—'}</td><td className="account-actions">{item.status === 'requested' && item.requestedByMembershipId === membershipId && canRequest && <button onClick={() => act(item, 'withdraw')}>撤回申请</button>}{item.status === 'requested' && <SourceFlowAction tenantKey={tenantKey} kind="invoice" id={item.id} version={item.status}>{item.requestedByMembershipId !== membershipId && canReview && <><button onClick={() => act(item, 'register')}>登记</button><button onClick={() => act(item, 'reject')}>退回</button></>}</SourceFlowAction>}{item.status === 'registered' && canReview && <button onClick={() => act(item, 'void')}>记录作废</button>}</td></tr>)}</tbody></table>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}</section>
    {canRequest && <ActionPanel title={<>申请开票</>} label="申请开票" busy={busy} successKey={message?.startsWith("内部开票申请已提交") ? message : null} error={message?.includes("已") ? null : message}><section className="form-panel"><p>仅限已确认合同，累计申请金额不得超过合同总额。</p><Field label="查找合同"><input value={search} onChange={e => { setSearch(e.target.value); setContractPage(1); }} placeholder="输入合同编号或客户名称" /></Field><div className="form-grid"><Field label="合同"><select value={contractId} onChange={e => { setContractId(e.target.value); setSelectedContract(eligibleContracts.find(item => item.id === e.target.value) ?? null); }}><option value="">请选择已确认合同</option>{eligibleContracts.map(item => <option key={item.id} value={item.id}>{item.number} · {item.customer?.name ?? ''} · {item.total} 元</option>)}</select></Field><Field label="申请金额（元）"><input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field></div><Field label="说明"><textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></Field><DialogAction><button className="primary" disabled={busy || !contractId || !selectedContract || !amount || Number(amount) <= 0} onClick={() => void request()}>提交申请</button></DialogAction>{contracts.data && <Pager page={contractPage} total={contracts.data.total} size={contracts.data.page_size} onPage={setContractPage} />}</section></ActionPanel>}
    {target && decision && <ConfirmDialog error={message} open title={decision === 'register' ? '登记内部开票记录' : decision === 'reject' ? '退回开票申请' : decision === 'void' ? '记录登记作废' : '撤回开票申请'} description={<div><p>{target.contract.number} · <Money value={target.amount} />。内部登记不会调用税票系统。</p>{decision === 'register' && <Field label="登记编号"><input maxLength={100} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></Field>}{['reject', 'void'].includes(decision) && <Field label="原因"><textarea maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>}{decision === 'void' && <Field label="外部作废凭据编号"><input maxLength={100} value={voidReference} onChange={e => setVoidReference(e.target.value)} /></Field>}</div>} busy={busy} confirmDisabled={!actionReady} onCancel={() => { setTarget(null); setDecision(null); }} onConfirm={() => void perform()} />}
  </>;
}
