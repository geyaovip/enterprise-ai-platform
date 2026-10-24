import { useState } from 'react';
import { Link } from 'react-router-dom';
import { erpApi } from '../api';
import { Empty, Loading, Notice, PageTitle, Field, Pager } from '../components';
import { useApiData } from '../hooks';

type WorkItem = {
  id: string;
  flowId?:string;
  kind: 'purchase_approval' | 'purchase_change' | 'sales_approval' | 'opportunity_followup' | 'invoice_registration' | 'receipt_claim' | 'task' | 'purchase_receipt' | 'sales_shipment' | 'return_approval' | 'account_overdue';
  resourceId: string;
  resourceName: string;
  title: string;
  detail: string;
  createdAt: string;
  dueAt: string | null;
};

export function WorkItemsPage({ tenantKey }: { tenantKey: string }) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const kinds = [['all', '全部事项'], ['task', '指派任务'],['return_approval','退货审核'],['account_overdue','逾期账款'], ['purchase_receipt', '采购入库'], ['sales_shipment', '销售发货'], ['purchase_approval', '采购审核'], ['purchase_change', '采购变更'], ['sales_approval', '销售审核'], ['opportunity_followup', '到期跟进'], ['invoice_registration', '开票核对'], ['receipt_claim', '收款认领']];
  const { data, loading, error, reload } = useApiData<{ items: WorkItem[]; total: number; page_size: number; counts: Record<string, number> }>(erpApi(tenantKey, `/work-items?page=${page}&kind=${kind}&q=${encodeURIComponent(query)}`));
  const href = (item: WorkItem) => item.flowId?`/t/${tenantKey}/erp/workflows?focus=${item.flowId}`: item.kind==='return_approval'?`/t/${tenantKey}/erp/returns?focus=${item.resourceId}`:item.kind==='account_overdue'?`/t/${tenantKey}/erp/finance`: item.kind === 'task' ? `/t/${tenantKey}/erp/collaboration?q=${encodeURIComponent(item.resourceName)}` : item.kind === 'opportunity_followup'
    ? `/t/${tenantKey}/erp/opportunities?q=${encodeURIComponent(item.resourceName)}`
    : item.kind === 'invoice_registration' ? `/t/${tenantKey}/erp/invoices?focus=${encodeURIComponent(item.resourceId)}`
    : item.kind === 'receipt_claim' ? `/t/${tenantKey}/erp/receipts?focus=${encodeURIComponent(item.resourceId)}`
    : `/t/${tenantKey}/erp/${['sales_approval', 'sales_shipment'].includes(item.kind) ? 'contracts' : 'purchases'}/${item.resourceId}`;
  return <>
    <PageTitle title="我的待办"  action={<><Link className="button" to={`/t/${tenantKey}/erp/workflows?view=sent`}>我发起的</Link><button type="button" onClick={() => void reload()}>刷新待办</button></>} />
    <form className="toolbar" onSubmit={e => { e.preventDefault(); setQuery(search); setPage(1); }}>
      <Field label="事项类型"><select value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}>{kinds.filter(([id]) => id === 'all' || id === kind || !data || data.counts[id] > 0).map(([id, title]) => <option key={id} value={id}>{title}{id !== 'all' ? ` (${data?.counts[id] ?? 0})` : ''}</option>)}</select></Field>
      <Field label="搜索事项"><input maxLength={100} value={search} onChange={e => setSearch(e.target.value)} placeholder="事项、单号或业务对象" /></Field><button>查询</button>
    </form>
    <Notice text={error} />
    <section className="panel table-wrap">
      {loading ? <Loading /> : !data?.items.length ? <Empty text="当前没有需要你处理的事项。" /> : <table><thead><tr><th>事项</th><th>业务对象</th><th>产生时间 / 截止时间</th><th>处理</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{item.title}</td><td>{item.detail}</td><td>{new Date(item.dueAt ?? item.createdAt).toLocaleString('zh-CN')}{item.dueAt && <small className="subline">{new Date(item.dueAt) <= new Date() ? '已到期' : '截止时间'}</small>}</td><td><Link className="button" to={href(item)}>查看并处理</Link></td></tr>)}</tbody></table>}
      {data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}
    </section>
  </>;
}
