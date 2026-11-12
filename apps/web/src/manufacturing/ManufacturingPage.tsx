import { DropdownSelect } from '@suite/frontend/components';
import { WarehousePage, TracePage } from './WarehousePage';
import { useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { DataResult, Empty, Field, PageTitle, Pager, Status } from '../components';
import { useApiData } from '../hooks';
import { amount, manufacturingApi, options, qty, SaveDialog, Search, text, useCatalog } from './common';
import type { OrderSummary, Page } from './common';
import { SetupPage } from './SetupPage';
import { OrderPage } from './OrderPage';
import './manufacturing.css';

export const manufacturingNavigation = [
  ['', '制造订单', 'manufacturing.read'],
  ['stock', '仓库与库存', 'manufacturing.read'],
  ['trace', '扫码追溯', 'manufacturing.read'],
  ['setup', '基础资料', 'manufacturing.setup'],
] as const;

function Orders({ tenantKey, permissions }: { tenantKey: string; permissions: readonly string[] }) {
  const navigate = useNavigate();
  const [newOrder, setNewOrder] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [selection, setSelection] = useState<Record<string, string>>({});
  const catalog = useCatalog(tenantKey, catalogQuery, newOrder);
  const customers = catalog.data?.customers ?? [];
  const materials = catalog.data?.materials.filter(m => m.kind === 'finished' && catalog.data?.links.some(l => l.materialId === m.id)) ?? [];
  const base = `/t/${tenantKey}/manufacturing`;
  const path = manufacturingApi(tenantKey, '/orders');
  const orders = useApiData<Page<OrderSummary>>(path + '?' + new URLSearchParams({ q, page: String(page) }));

  return <>
    <PageTitle title="制造订单" action={permissions.includes('manufacturing.order') && <button className="primary" onClick={() => { setSelection({}); setCatalogQuery(''); setNewOrder(true); }}>新建订单</button>}/>
    <Search label="搜索订单号、客户或成品" value={q} onChange={value => { setPage(1); setQ(value); }}/>
    <DataResult {...orders}>
      {orders.data?.items.length ? <section className="panel table-wrap"><table>
        <thead><tr><th>订单号</th><th>客户</th><th>成品</th><th>接单量</th><th>已入库</th><th>已发货</th><th>交付日期</th><th>进度</th></tr></thead>
        <tbody>{orders.data.items.map(order => <tr key={order.id}>
          <td><Link to={base + '/orders/' + order.id}>{order.number}</Link></td><td>{order.customerName}</td>
          <td>{order.sku} · {order.productName}</td><td>{amount(order.quantity)}</td><td>{amount(order.completedQty)}</td>
          <td>{amount(order.shippedQty)}</td><td>{order.dueDate || '—'}</td>
          <td>{order.salesStatus !== 'confirmed' ? <Status value={order.salesStatus}/> : <Status value={order.shippedQty === order.quantity ? 'completed' : 'running'} label={order.shippedQty === order.quantity ? '已交付' : '履约中'}/>}</td>
        </tr>)}</tbody>
      </table><Pager page={page} total={orders.data.total} size={orders.data.page_size} onPage={setPage}/></section>
        : <Empty text={q ? '没有找到匹配的订单。' : '新建订单后，可按 BOM 核对库存并开始备料。'}/>}
    </DataResult>
    {newOrder && <SaveDialog title="新建制造订单" path={path} close={() => setNewOrder(false)} saved={result => navigate(base + '/orders/' + result.id)}
      confirmLabel="确认接单" body={form => ({
        number: text(form, 'number'), customerId: text(form, 'customerId'), materialId: text(form, 'materialId'),
        warehouseId: text(form, 'warehouseId') || undefined, quantity: qty(form), dueDate: text(form, 'dueDate') || undefined,
        approvalRequired: form.has('approvalRequired'),
      })}>
      <DataResult {...catalog}>
        {!customers.length || !materials.length ? <p className="muted">请选择已建档的客户和成品。{permissions.includes('manufacturing.setup') && <Link to={base + '/setup'}>打开基础资料</Link>}</p> : null}
      </DataResult>
      <Field label="筛选客户或成品候选"><input type="search" value={catalogQuery} onChange={e => setCatalogQuery(e.target.value)} placeholder="输入编码或名称"/></Field>
      <div className="form-grid">
        <Field label="订单号"><input required name="number" maxLength={80}/></Field>
        <Field label="客户"><DropdownSelect required name="customerId" value={selection.customerId ?? ''} onChange={e => setSelection({ ...selection, customerId: e.target.value })}><option value="">选择客户</option>
          {selection.customerId && !customers.some(c => c.id === selection.customerId) && <option value={selection.customerId}>已选客户</option>}{options(customers)}
        </DropdownSelect></Field>
        <Field label="成品"><DropdownSelect required name="materialId" value={selection.materialId ?? ''} onChange={e => setSelection({ ...selection, materialId: e.target.value })}><option value="">选择成品</option>
          {selection.materialId && !materials.some(c => c.id === selection.materialId) && <option value={selection.materialId}>已选成品</option>}{options(materials)}
        </DropdownSelect></Field>
        <Field label="订单数量（件）"><input required type="number" name="quantity" min="1" max="10000000" step="1"/></Field>
        <Field label="作业仓库"><DropdownSelect name="warehouseId" defaultValue=""><option value="">默认仓库</option>{options(catalog.data?.warehouses ?? [])}</DropdownSelect></Field>
        <Field label="交付日期"><input type="date" name="dueDate"/></Field>
        <label><input name="approvalRequired" type="checkbox"/> 由另一位管理员审核接单</label>
      </div>
    </SaveDialog>}
  </>;
}

function SelectedOrder({ tenantKey, permissions }: { tenantKey: string; permissions: readonly string[] }) {
  const { id = '' } = useParams();
  return <OrderPage key={id} tenantKey={tenantKey} id={id} permissions={permissions}/>;
}

export function ManufacturingPage({ tenantKey, permissions }: { tenantKey: string; permissions: readonly string[] }) {
  if (!permissions.includes('manufacturing.read')) return <Empty text="制造业进销存未启用，或当前岗位没有访问权限。"/>;
  return <Routes>
    <Route index element={<Orders tenantKey={tenantKey} permissions={permissions}/>}/>
    <Route path="orders/:id" element={<SelectedOrder tenantKey={tenantKey} permissions={permissions}/>}/>
    <Route path="stock" element={<WarehousePage tenantKey={tenantKey} permissions={permissions}/>}/>
    <Route path="trace" element={<TracePage tenantKey={tenantKey}/>}/>
    <Route path="setup" element={permissions.includes('manufacturing.setup') ? <SetupPage tenantKey={tenantKey}/> : <Empty text="仅企业管理员可维护基础资料。"/>}/>
    <Route path="*" element={<Navigate to={`/t/${tenantKey}/manufacturing`} replace/>}/>
  </Routes>;
}
