import { useState } from 'react';
import { Empty, Field, Status } from '../components';
import { amount, qty, SaveDialog, text, TrackingFields, trackingFrom } from './common';
import type { Purchase } from './common';

const actions = { submit: '提交审核', approve: '确认采购', receive: '采购收货', close_purchase: '关闭采购' };
type Mode = { action: keyof typeof actions; purchase: Purchase };

export function StockPurchases({ path, warehouseId, purchases, actorMembershipId, canApproveDraft, permissions, saved }: {
  path: string; warehouseId: string; purchases: Purchase[]; actorMembershipId: string; canApproveDraft: boolean;
  permissions: readonly string[]; saved: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const allowed = (p: string) => permissions.includes('manufacturing.' + p);
  const receivable = mode?.purchase.lines.filter(l => l.quantity > l.receivedQty) ?? [];
  return <section className="panel table-wrap"><h2>安全库存补货单</h2>
    {!purchases.length ? <Empty text="暂无补货单"/> : <table>
      <thead><tr><th>单号</th><th>供应商</th><th>状态</th><th>收货进度</th><th>操作</th></tr></thead>
      <tbody>{purchases.map(purchase => {
        const own = purchase.createdByMembershipId === actorMembershipId;
        return <tr key={purchase.id}><td>{purchase.number}</td><td>{purchase.supplier.name}</td><td><Status value={purchase.status}/></td>
          <td>{purchase.lines.map(l => <div key={l.id}>{l.sku} · {amount(l.receivedQty)} / {amount(l.quantity)}</div>)}</td>
          <td><div className="manufacturing-actions">
            {own && purchase.status === 'draft' && allowed('buy') && !canApproveDraft &&
              <button onClick={() => setMode({ action: 'submit', purchase })}>{actions.submit}</button>}
            {allowed('approve') && ((own && purchase.status === 'draft' && canApproveDraft) || (!own && purchase.status === 'pending_approval')) &&
              <button onClick={() => setMode({ action: 'approve', purchase })}>{actions.approve}</button>}
            {allowed('stock') && ['ordered', 'partial_received'].includes(purchase.status) &&
              <button onClick={() => setMode({ action: 'receive', purchase })}>{actions.receive}</button>}
            {allowed('approve') && ['draft', 'pending_approval', 'ordered', 'partial_received'].includes(purchase.status) &&
              <button onClick={() => setMode({ action: 'close_purchase', purchase })}>{actions.close_purchase}</button>}
          </div></td></tr>;
      })}</tbody>
    </table>}
    {mode && <SaveDialog title={actions[mode.action]} path={path} close={() => setMode(null)}
      saved={() => { setMode(null); saved(); }} confirmLabel={actions[mode.action]} body={form => {
        const lines = receivable.filter(l => qty(form, l.id) > 0).map(l => ({
          lineId: l.id, quantity: qty(form, l.id), tracking: trackingFrom(form, l.id),
        }));
        if (mode.action === 'receive' && !lines.length) throw new Error('请填写本次收货数量');
        return { action: mode.action, warehouseId, purchaseId: mode.purchase.id, version: mode.purchase.version,
          lines: mode.action === 'receive' ? lines : undefined, reason: text(form, 'reason') || undefined };
      }}>
      <p>{mode.purchase.number} · {mode.purchase.supplier.name}</p>
      {mode.action === 'close_purchase' && <Field label="关闭原因"><input required name="reason" maxLength={500}/></Field>}
      {mode.action === 'receive' && receivable.map(line => <fieldset key={line.id} className="manufacturing-line"><legend>{line.sku}</legend>
        <Field label="本次实收"><input type="number" min="0" step="0.000001" name={line.id} max={Math.round((line.quantity-line.receivedQty)*1e6)/1e6}/></Field>
        <TrackingFields suffix={line.id}/>
      </fieldset>)}
    </SaveDialog>}
  </section>;
}
