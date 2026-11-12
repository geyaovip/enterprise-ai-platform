import { DropdownSelect } from '@suite/frontend/components';
import { ProductionPanel } from './ProductionPanel';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataResult, DetailFacts, Empty, Field, Notice, PageTitle, SectionTabs, Status } from '../components';
import { useApiData } from '../hooks';
import { amount, manufacturingApi, options, qty, SaveDialog, text, TrackingFields, trackingFrom, useCatalog } from './common';
import type { Order, Purchase, Requirement } from './common';

type Action =
  | { type: 'purchase' }
  | { type: 'submit' | 'approve' | 'receive' | 'close_purchase'; purchase: Purchase }
  | { type: 'issue' | 'return'; row: Requirement }
  | { type: 'complete' | 'ship' }
  | { type: 'hold'; item: { id: string; label: string; unit: string; reserved: string; max: number } };
const labels = {
  purchase: '生成缺料采购单', submit: '提交采购审核', approve: '确认采购', receive: '采购收货',
  close_purchase: '关闭采购', hold: '调整锁库', issue: '生产领料', return: '生产退料', complete: '成品入库', ship: '确认发货',
};
const docLabels: Record<string, string> = {
  receipt: '采购入库', material_issue: '生产领料', material_return: '生产退料',
  production_receipt: '成品入库', manufacturing_shipment: '销售发货',
};

export function OrderPage({ tenantKey, id, permissions }: { tenantKey: string; id: string; permissions: readonly string[] }) {
  const base = manufacturingApi(tenantKey, '/orders/' + id);
  const request = useApiData<Order>(base);
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState('');
  const [review, setReview] = useState<'confirmed' | 'rejected' | null>(null);
  const allowed = (action: string) => permissions.includes('manufacturing.' + action);
  const order = request.data;
  const open = (next: Action) => { setMessage(''); setAction(next); };
  const saved = (result: { id: string; number?: string }) => {
    setMessage(result.number ? `已处理 · ${result.number}` : '已处理');
    setAction(null);
    void request.reload();
  };

  return <>
    <PageTitle title={order?.number ?? '制造订单'} back={<Link className="button" to={`/t/${tenantKey}/manufacturing`}>返回订单</Link>}/>
    <Notice text={message} tone="success"/>
    <DataResult {...request}>
      {order && <>
        <section className="panel manufacturing-summary">
          <DetailFacts items={[
            { label: '客户', value: order.customerName }, { label: '成品', value: `${order.sku} · ${order.productName}` },
            { label: '作业仓库', value: order.warehouse?.name }, { label: 'BOM 版本', value: 'V' + order.bomRevision },
            { label: '订单数量', value: `${amount(order.quantity)} 件` }, { label: '已入库', value: `${amount(order.completedQty)} 件` },
            { label: '已发货', value: `${amount(order.shippedQty)} 件` }, { label: '交付日期', value: order.dueDate },
          ]}/>
        </section>
        {order.salesStatus !== 'confirmed' && <section className="panel">
          <h2>接单审核</h2><Status value={order.salesStatus}/>
          {order.salesReviewNote && <p>{order.salesReviewNote}</p>}
          {order.salesStatus === 'pending_approval' && <p className="muted">通过后，采购、计划和仓库才能办理本单。</p>}
          {order.salesStatus === 'pending_approval' && allowed('setup') && order.createdBy !== order.actorMembershipId &&
            <div className="manufacturing-actions">
              <button className="primary" onClick={() => setReview('confirmed')}>通过接单</button>
              <button onClick={() => setReview('rejected')}>退回接单</button>
            </div>}
        </section>}
        {review && <SaveDialog title={review === 'confirmed' ? '通过接单' : '退回接单'} path={base + '/actions'}
          close={() => setReview(null)} saved={result => { setReview(null); saved(result); }}
          body={f => ({ action: 'review_order', version: order.version, decision: review, reason: text(f, 'reason') })}>
          <Field label={review === 'rejected' ? '退回原因' : '审核备注'}><input name="reason" maxLength={500} required={review === 'rejected'}/></Field>
        </SaveDialog>}
        {order.salesStatus === 'confirmed' && <SectionTabs label="订单作业" items={[
          { id: 'supply', label: '备料与采购', content: <>
            <section className="panel table-wrap">
              <div className="panel-heading manufacturing-heading"><h2>物料需求</h2>
                {allowed('buy') && order.requirements.some(r => Number(r.suggested) > 0) && <button className="primary" onClick={() => open({ type: 'purchase' })}>{labels.purchase}</button>}
              </div>
              <table><thead><tr><th>物料</th><th>需求</th><th>已领</th><th>仓库现存</th><th>本单可用</th><th>本单锁定</th><th>缺料</th><th>待确认采购</th><th>在途</th><th>待补</th></tr></thead>
                <tbody>{order.requirements.map(row => <tr key={row.productId}><td>{row.sku} · {row.name}（{row.unit}）</td>
                  <td>{amount(row.quantity)}</td><td>{amount(row.issued)}</td><td>{amount(row.onHand)}</td><td>{amount(row.available)}</td><td>{amount(row.reserved)}</td><td>{amount(row.shortage)}</td>
                  <td>{amount(row.pending)}</td><td>{amount(row.incoming)}</td><td>{amount(row.suggested)}</td></tr>)}</tbody>
              </table>
            </section>
            <section className="panel table-wrap"><h2>关联采购</h2>
              {order.purchases.length ? <table>
                <thead><tr><th>采购单</th><th>供应商</th><th>状态</th><th>明细</th><th>操作</th></tr></thead>
                <tbody>{order.purchases.map(purchase => {
                  const own = purchase.createdByMembershipId === order.actorMembershipId;
                  return <tr key={purchase.id}><td>{purchase.number}</td><td>{purchase.supplier.name}</td><td><Status value={purchase.status}/></td>
                    <td>{purchase.lines.map(l => <div key={l.id}>{l.sku} · 已收 {amount(l.receivedQty)} / {amount(l.quantity)}</div>)}</td>
                    <td><div className="manufacturing-actions">
                      {purchase.status === 'draft' && own && allowed('buy') && !(order.canApproveDraft && allowed('approve')) && <button onClick={() => open({ type: 'submit', purchase })}>{labels.submit}</button>}
                      {allowed('approve') && ((purchase.status === 'draft' && own && order.canApproveDraft) || (purchase.status === 'pending_approval' && !own)) && <button onClick={() => open({ type: 'approve', purchase })}>{labels.approve}</button>}
                      {allowed('approve') && ['draft', 'pending_approval', 'ordered', 'partial_received'].includes(purchase.status) && <button onClick={() => open({ type: 'close_purchase', purchase })}>{labels.close_purchase}</button>}
                      {allowed('stock') && ['ordered', 'partial_received'].includes(purchase.status) && <button onClick={() => open({ type: 'receive', purchase })}>{labels.receive}</button>}
                    </div></td></tr>;
                })}</tbody>
              </table> : <Empty text="暂无采购单"/>}
            </section>
          </> },
          { id: 'plan', label: '计划与报工', content: <ProductionPanel order={order} tenantKey={tenantKey} permissions={permissions} saved={saved}/> },
          { id: 'production', label: '生产与发货', content: <>
            <section className="panel table-wrap"><h2>工单领退料</h2>
              <table><thead><tr><th>物料</th><th>需求</th><th>已领</th><th>已耗用</th><th>本单可用</th><th>本单锁定</th>{allowed('stock') && <th>操作</th>}</tr></thead>
                <tbody>{order.requirements.map(row => <tr key={row.productId}><td>{row.sku} · {row.name}（{row.unit}）</td>
                  <td>{amount(row.quantity)}</td><td>{amount(row.issued)}</td><td>{amount(row.consumed)}</td><td>{amount(row.available)}</td><td>{amount(row.reserved)}</td>
                  {allowed('stock') && <td><div className="manufacturing-actions">
                    {Number(row.issued) < Number(row.quantity) && <button disabled={Number(row.available) < 0.001} onClick={() => open({ type: 'issue', row })}>领料</button>}
                    {(Number(row.reserved) > 0 || Number(row.available) > 0 && Number(row.issued) < Number(row.quantity)) &&
                      <button onClick={() => open({ type: 'hold', item: {
                        id: row.productId, label: row.name, unit: row.unit, reserved: row.reserved,
                        max: Math.min(Number(row.available), Number(row.quantity) - Number(row.issued)),
                      } })}>调整锁库</button>}
                    {Number(row.issued) > Number(row.consumed) && <button onClick={() => open({ type: 'return', row })}>退料</button>}
                  </div></td>}
                </tr>)}</tbody>
              </table>
            </section>
            <section className="panel">
              <div className="panel-heading manufacturing-heading"><h2>成品与发货</h2>
                <div className="manufacturing-actions">
                  {allowed('complete') && order.completedQty < order.quantity && <button disabled={order.readyToComplete < 1} className="primary" onClick={() => open({ type: 'complete' })}>{labels.complete}</button>}
                  {allowed('stock') && order.shippedQty < order.completedQty && (Number(order.finishedAvailable) > 0 || Number(order.finishedReserved) > 0) &&
                    <button onClick={() => open({ type: 'hold', item: { id: order.productId, label: order.productName, unit: '件',
                      reserved: order.finishedReserved, max: Math.min(Number(order.finishedAvailable), order.completedQty - order.shippedQty),
                    } })}>锁定成品</button>}
                  {allowed('stock') && order.shippedQty < order.completedQty && <button disabled={Number(order.finishedAvailable) < 1} onClick={() => open({ type: 'ship' })}>{labels.ship}</button>}
                </div>
              </div>
              <DetailFacts items={[
                { label: '当前可入库', value: `${amount(order.readyToComplete)} 件` },
                { label: '本单已入库', value: `${amount(order.completedQty)} / ${amount(order.quantity)} 件` },
                { label: '本单已发货', value: `${amount(order.shippedQty)} 件` },
                { label: '仓库成品现存', value: `${amount(order.finishedOnHand)} 件` },
                { label: '本单成品锁定', value: `${amount(order.finishedReserved)} 件` },
              ]}/>
            </section>
          </> },
          { id: 'documents', label: '出入库记录', content: <section className="panel table-wrap"><h2>出入库记录</h2>
            {order.documents.length ? <table><thead><tr><th>单号</th><th>类型</th><th>明细</th><th>时间</th></tr></thead>
              <tbody>{order.documents.map(doc => <tr key={doc.id}><td>{doc.number}</td><td>{docLabels[doc.kind] ?? doc.kind}</td>
                <td>{doc.movements.map((m, i) => {
                  const material = order.requirements.find(r => r.productId === m.productId);
                  return <div key={i}>{material?.sku ?? (m.productId === order.productId ? order.sku : '其他物料')} · {amount(m.quantity)} {material?.unit ?? '件'}{m.trackingCode && <small> · <Link to={`/t/${tenantKey}/manufacturing/trace?code=${encodeURIComponent(m.trackingCode)}`}>{m.trackingCode}</Link></small>}</div>;
                })}</td><td>{new Date(doc.createdAt).toLocaleString('zh-CN')}</td>
              </tr>)}</tbody></table> : <Empty text="暂无出入库记录"/>}
          </section> },
        ]}/>}
        {action && <OrderActionDialog action={action} order={order} tenantKey={tenantKey} path={base + '/actions'} close={() => setAction(null)} saved={saved}/>}
      </>}
    </DataResult>
  </>;
}

function OrderActionDialog({ action, order, tenantKey, path, close, saved }: {
  action: Action; order: Order; tenantKey: string; path: string; close: () => void;
  saved: (result: { id: string; number?: string }) => void;
}) {
  const [q, setQ] = useState('');
  const catalog = useCatalog(tenantKey, q, action.type === 'purchase');
  const title = labels[action.type];
  const short = order.requirements.filter(row => Number(row.suggested) > 0);
  const ready = 'purchase' in action ? action.purchase.lines.filter(l => l.receivedQty < l.quantity) : [];

  function body(form: FormData): Record<string, unknown> {
    if (action.type === 'purchase') {
      const lines = short.filter(row => qty(form, 'qty-' + row.productId) > 0).map(row => ({
        productId: row.productId, quantity: qty(form, 'qty-' + row.productId), unitPrice: text(form, 'price-' + row.productId),
      }));
      if (!lines.length || lines.some(l => !l.unitPrice)) throw new Error('至少填写一条采购数量和单价');
      return { action: action.type, supplierId: text(form, 'supplier'), lines };
    }
    if ('purchase' in action) {
      const purchase = action.purchase;
      const lines = ready.filter(l => qty(form, l.id) > 0).map(l => ({ lineId: l.id, quantity: qty(form, l.id), tracking: trackingFrom(form, l.id) }));
      if (action.type === 'receive' && !lines.length) throw new Error('至少填写一条实际收货数量');
      return { action: action.type, purchaseId: purchase.id, version: purchase.version, lines: action.type === 'receive' ? lines : undefined, reason: action.type === 'close_purchase' ? text(form, 'reason') : undefined };
    }
    if (action.type === 'hold') return { action: action.type, version: order.version, productId: action.item.id, quantity: qty(form) };
    return { action: action.type, version: order.version, quantity: qty(form), tracking: trackingFrom(form), ...('row' in action ? { productId: action.row.productId } : {}) };
  }

  return <SaveDialog title={title} path={path} close={close} saved={saved} body={body} confirmLabel={action.type === 'purchase' ? '创建采购草稿' : title}>
    {action.type === 'purchase' && <>
      <Field label="筛选供应商"><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="输入编码或名称"/></Field>
      <DataResult {...catalog}><Field label="供应商"><DropdownSelect name="supplier" required defaultValue=""><option value="">选择供应商</option>{options(catalog.data?.suppliers ?? [])}</DropdownSelect></Field></DataResult>
      <p className="muted">本单同一供应商的物料可合并采购。数量留空时跳过该物料。</p>
      {short.map(row => <fieldset key={row.productId} className="manufacturing-line"><legend>{row.sku} · {row.name}</legend><div className="form-grid">
        <Field label={`采购数量（${row.unit}）`}><input name={'qty-' + row.productId} type="number" min="0" max={row.suggested} step="0.001" placeholder={row.suggested}/></Field>
        <Field label="采购单价（元）"><input name={'price-' + row.productId} type="number" min="0" step="0.01"/></Field>
      </div></fieldset>)}
    </>}
    {'purchase' in action && <p>采购单 {action.purchase.number} · {action.purchase.supplier.name}</p>}
    {action.type === 'close_purchase' && <>
      <p className="muted">关闭后，未收数量会重新纳入缺料计算。已收货仍保留在库存账中。</p>
      <Field label="关闭原因"><input required name="reason" maxLength={500}/></Field>
    </>}
    {action.type === 'receive' && <>
      <p className="muted">按实际到货量记入{order.warehouse?.name ?? '作业仓库'}，支持分批收货。</p>
      {ready.map(line => <fieldset key={line.id} className="manufacturing-line"><legend>{line.sku}</legend><Field key={line.id} label={`${line.sku} · 本次实收（剩余 ${amount(line.quantity - line.receivedQty)}）`}>
        <input type="number" min="0" max={Math.round((line.quantity - line.receivedQty) * 1000) / 1000} step="0.001" name={line.id}/></Field><TrackingFields suffix={line.id}/></fieldset>)}
    </>}
    {'row' in action && <>
      <p>{action.row.sku} · {action.row.name} · {order.warehouse?.name}</p>
      <Field label={`本次数量（${action.row.unit}）`}>
        <input required name="quantity" type="number" min="0.001" step="0.001" max={Math.round(1000 * (action.type === 'issue' ?
          Math.min(Number(action.row.available), Number(action.row.quantity) - Number(action.row.issued)) :
          Number(action.row.issued) - Number(action.row.consumed))) / 1000}/>
      </Field>
      <TrackingFields/>
    </>}
    {action.type === 'hold' && <>
      <p>{action.item.label} · {order.warehouse?.name}</p>
      <Field label={`锁定数量（${action.item.unit}）`} hint="填写调整后的总量，填 0 释放本单锁定。">
        <input required type="number" name="quantity" min="0" max={action.item.max} step="0.001" defaultValue={action.item.reserved}/>
      </Field>
    </>}
    {(action.type === 'complete' || action.type === 'ship') && <>
      <p>{order.sku} · {order.productName} · {order.warehouse?.name}</p>
      <Field label="本次数量（件）"><input required name="quantity" type="number" min="1" step="1"
        max={action.type === 'complete' ? order.readyToComplete : Math.min(order.completedQty - order.shippedQty, Math.floor(Number(order.finishedAvailable)))}/></Field>
      <TrackingFields/>
      <p className="muted">{action.type === 'complete' ? '按合格数量入库，系统根据本单已领料和 BOM 核对用量。' : '确认后从作业仓库扣减成品库存。'}</p>
    </>}
  </SaveDialog>;
}
