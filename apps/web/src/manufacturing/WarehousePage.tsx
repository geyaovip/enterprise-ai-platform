import { DropdownSelect } from '@suite/frontend/components';
import { StockPurchases } from './StockPurchases';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataResult, Empty, Field, Notice, PageTitle, Pager, Status } from '../components';
import { useApiData } from '../hooks';
import { amount, manufacturingApi, options, qty, SaveDialog, Search, text, TrackingFields, trackingFrom, useCatalog } from './common';
import type { Choice, Page, Purchase } from './common';

type Stock = { id: string; sku: string; name: string; unit: string; physical: number; reserved: number; available: number; reorderPoint: number; suggested: number; low: boolean; version: number | null };
type StockPage = Page<Stock> & { warehouses: Choice[]; warehouseId?: string; purchases: Purchase[]; actorMembershipId: string; canApproveDraft: boolean };
type Mode = { kind: 'warehouse' } | { kind: 'transfer' | 'stocktake' | 'threshold' | 'replenish'; row: Stock };
type Trace = {
  code: string; total: number; products: Choice[]; warehouses: Choice[];
  stock: { warehouseId: string; productId: string; quantity: string }[];
  movements: { id: string; warehouseId: string | null; productId: string; direction: string; quantity: number;
    sourceType: string; sourceId: string; createdAt: string; document: { id: string; number: string } }[];
  upstream: { documentId: string; productId: string; code: string | null; quantity: string; order: { id: string; number: string } }[];
  outputs: { id: string; number: string; movements: { trackingCode: string | null; productId: string }[] }[];
  downstream: { documentId: string; productId: string; quantity: string; order: { id: string; number: string } }[];
};

const labels = { warehouse: '新建仓库', transfer: '仓库调拨', stocktake: '登记盘点', threshold: '设置安全库存', replenish: '创建补货草稿' };
const types: Record<string,string> = {
  purchase: '采购入库', transfer: '调拨', stocktake: '盘点', material_issue: '生产领料',
  material_return: '生产退料', production_receipt: '成品入库', manufacturing_shipment: '销售发货',
};

export function WarehousePage({ tenantKey, permissions }: { tenantKey: string; permissions: readonly string[] }) {
  const [warehouseId, setWarehouseId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [alerts, setAlerts] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [message, setMessage] = useState('');
  const path = manufacturingApi(tenantKey, '/stock');
  const filters = new URLSearchParams({ q, page: String(page), alerts: String(alerts), ...(warehouseId ? { warehouseId } : {}) });
  const request = useApiData<StockPage>(path + '?' + filters);
  const data = request.data;
  const catalog = useCatalog(tenantKey, '', mode?.kind === 'replenish');
  const selected = data?.warehouseId;
  const admin = permissions.includes('manufacturing.setup');
  const stock = permissions.includes('manufacturing.stock');
  const buy = permissions.includes('manufacturing.buy');

  return <>
    <PageTitle title="仓库与库存" action={admin && <button className="primary" onClick={() => setMode({ kind: 'warehouse' })}>{labels.warehouse}</button>}/>
    <Notice text={message} tone="success"/>
    <div className="toolbar">
      <Field label="仓库"><DropdownSelect value={selected ?? ''} onChange={e => { setWarehouseId(e.target.value); setPage(1); }} disabled={!data?.warehouses.length}>
        {!data?.warehouses.length && <option value="">暂无仓库</option>}{options(data?.warehouses ?? [])}
      </DropdownSelect></Field>
      <label><input type="checkbox" checked={alerts} onChange={e => { setAlerts(e.target.checked); setPage(1); }}/> 只看库存预警</label>
    </div>
    <Search label="搜索物料编码或名称" value={q} onChange={value => { setQ(value); setPage(1); }}/>
    <DataResult {...request}>
      {data?.items.length ? <section className="panel table-wrap"><table>
        <thead><tr><th>物料</th><th>实存</th><th>锁定</th><th>可用</th><th>安全库存</th><th>建议补货</th><th>状态</th>{(admin || stock || buy) && <th>操作</th>}</tr></thead>
        <tbody>{data.items.map(row => <tr key={row.id}>
          <td>{row.sku} · {row.name}（{row.unit}）</td><td>{amount(row.physical)}</td><td>{amount(row.reserved)}</td>
          <td>{amount(row.available)}</td><td>{amount(row.reorderPoint)}</td><td>{amount(row.suggested)}</td>
          <td>{row.low ? <Status value="low_stock" label="低库存"/> : '—'}</td>
          {(admin || stock || buy) && <td><div className="manufacturing-actions">
            {stock && <button onClick={() => setMode({ kind: 'stocktake', row })} disabled={row.version === null}>盘点</button>}
            {stock && <button onClick={() => setMode({ kind: 'transfer', row })} disabled={row.available <= 0 || data.warehouses.length < 2}>调拨</button>}
            {admin && <button onClick={() => setMode({ kind: 'threshold', row })}>安全库存</button>}
            {buy && row.suggested > 0 && <button onClick={() => setMode({ kind: 'replenish', row })}>补货</button>}
          </div></td>}
        </tr>)}</tbody>
      </table><Pager page={page} total={data.total} size={data.page_size} onPage={setPage}/></section>
        : <Empty text={selected ? '没有符合条件的库存记录。' : '请先新建作业仓库。'}/>}
    </DataResult>
    {data && selected && <StockPurchases path={path + '/actions'} warehouseId={selected} purchases={data.purchases}
      actorMembershipId={data.actorMembershipId} canApproveDraft={data.canApproveDraft} permissions={permissions} saved={() => void request.reload()}/>}
    {mode && <SaveDialog title={labels[mode.kind]} path={path + '/actions'} close={() => setMode(null)}
      saved={() => { setMode(null); setMessage('已保存'); void request.reload(); }} body={form => {
        if (mode.kind === 'warehouse') return { action: mode.kind, code: text(form, 'code'), name: text(form, 'name') };
        const productId = mode.row.id;
        const quantity = qty(form);
        if (mode.kind === 'replenish') return { action: mode.kind, warehouseId: selected, supplierId: text(form, 'supplier'),
          line: { productId, quantity, unitPrice: text(form, 'unitPrice') } };
        if (mode.kind === 'transfer') return { action: mode.kind, fromWarehouseId: selected, toWarehouseId: text(form, 'destination'),
          productId, quantity, tracking: trackingFrom(form), note: text(form, 'note') };
        if (mode.kind === 'stocktake') return { action: mode.kind, warehouseId: selected, productId, quantity,
          tracking: trackingFrom(form), version: mode.row.version };
        return { action: mode.kind, productId, quantity };
      }}>
      {mode.kind === 'warehouse' ? <div className="form-grid">
        <Field label="仓库编码"><input required name="code" maxLength={40}/></Field>
        <Field label="仓库名称"><input required name="name" maxLength={100}/></Field>
      </div> : <>
        <p>{mode.row.sku} · {mode.row.name}</p>
        {mode.kind === 'transfer' && <Field label="调入仓库"><DropdownSelect required name="destination" defaultValue="">
          <option value="">选择仓库</option>{options(data?.warehouses.filter(w => w.id !== selected) ?? [])}
        </DropdownSelect></Field>}
        {mode.kind === 'replenish' && <>
          <Field label="供应商"><DropdownSelect required name="supplier" defaultValue=""><option value="">选择供应商</option>{options(catalog.data?.suppliers ?? [])}</DropdownSelect></Field>
          <Field label="采购单价"><input required type="number" min="0" step="0.01" name="unitPrice"/></Field>
          <p className="muted">提交时会扣除本仓已生成的补货采购量。</p>
        </>}
        <Field label={mode.kind === 'replenish' ? '采购数量' : mode.kind === 'stocktake' ? '实盘数量' : mode.kind === 'threshold' ? '安全库存数量' : '调拨数量'}>
          <input name="quantity" required type="number" min={mode.kind === 'transfer' || mode.kind === 'replenish' ? '0.000001' : '0'}
            max={mode.kind === 'transfer' ? mode.row.available : mode.kind === 'replenish' ? mode.row.suggested : 1_000_000_000} step="0.000001"
            defaultValue={mode.kind === 'threshold' ? mode.row.reorderPoint : mode.kind === 'replenish' ? mode.row.suggested : undefined}/>
        </Field>
        {mode.kind === 'stocktake' && <p className="muted">填追溯码时登记该批次／序列号的实盘量，留空时登记仓库实盘总量。</p>}
        {(mode.kind === 'stocktake' || mode.kind === 'transfer') && <TrackingFields/>}
        {mode.kind === 'transfer' && <Field label="调拨原因"><input required name="note" maxLength={500}/></Field>}
      </>}
    </SaveDialog>}
  </>;
}

export function TracePage({ tenantKey }: { tenantKey: string }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('code') ?? '';
  const setQ = (code: string) => setParams(code ? { code } : {}, { replace: true });
  const request = useApiData<Trace>(q ? manufacturingApi(tenantKey, '/scan?code=' + encodeURIComponent(q)) : null);
  const data = request.data;
  const product = (id: string) => {
    const item = data?.products.find(p => p.id === id);
    return item ? item.sku + ' · ' + item.name : '关联物料';
  };
  const warehouse = (id: string | null) => data?.warehouses.find(w => w.id === id)?.name ?? '—';
  const base = `/t/${tenantKey}/manufacturing/orders/`;
  return <>
    <PageTitle title="扫码追溯"/>
    <Search label="扫描或输入批次／序列号" value={q} onChange={setQ} maxLength={100}/>
    {!q ? <Empty text="扫码枪输入后按回车查询，也可输入追溯码。"/> : <DataResult {...request}>
      {!data?.total ? <Empty text="没有找到该追溯码的单据。"/> : <>
        <section className="panel table-wrap"><h2>在库位置</h2>
          {data.stock.length ? <table><thead><tr><th>物料</th><th>仓库</th><th>数量</th></tr></thead>
            <tbody>{data.stock.map(row => <tr key={row.warehouseId + row.productId}>
              <td>{product(row.productId)}</td><td>{warehouse(row.warehouseId)}</td><td>{amount(row.quantity)}</td>
            </tr>)}</tbody></table> : <Empty text="该码当前无在库余额。"/>}
        </section>
        <section className="panel table-wrap"><h2>出入库记录</h2>
          {data.total > data.movements.length && <p className="muted">显示最近 {data.movements.length} 条，共 {data.total} 条。</p>}
          <table><thead><tr><th>动作</th><th>数量</th><th>物料</th><th>仓库</th><th>时间</th><th>单号</th></tr></thead>
            <tbody>{data.movements.map(row => <tr key={row.id}>
              <td>{types[row.sourceType] ?? (row.direction === 'in' ? '入库' : '出库')}</td>
              <td>{amount(row.quantity)}</td><td>{product(row.productId)}</td><td>{warehouse(row.warehouseId)}</td>
              <td>{new Date(row.createdAt).toLocaleString('zh-CN')}</td><td>{row.document.number}</td>
            </tr>)}</tbody></table>
        </section>
        {(data.upstream.length > 0 || data.downstream.length > 0) && <section className="panel table-wrap"><h2>生产用料关系</h2>
          <table><thead><tr><th>制造订单</th><th>耗用物料</th><th>原料追溯码</th><th>耗用量</th><th>成品入库凭证</th></tr></thead>
            <tbody>{[...data.upstream, ...data.downstream.map(row => ({ ...row, code: q }))].map((row, i) => <tr key={row.documentId + i}>
              <td><Link to={base + row.order.id}>{row.order.number}</Link></td><td>{product(row.productId)}</td><td>{row.code ?? '无批次'}</td>
              <td>{amount(row.quantity)}</td><td>{data.outputs.find(d => d.id === row.documentId)?.number ?? data.movements.find(m => m.document.id === row.documentId)?.document.number ?? '见订单出入库记录'}
                {data.outputs.find(d => d.id === row.documentId)?.movements.map((movement, index) => movement.trackingCode &&
                  <div key={index}>{product(movement.productId)} · {movement.trackingCode}</div>)}</td>
            </tr>)}</tbody></table>
        </section>}
      </>}
    </DataResult>}
  </>;
}
