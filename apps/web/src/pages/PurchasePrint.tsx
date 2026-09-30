import { Money } from '../components';
import type { Purchase } from '../types';

export function PurchasePrint({ order }: { order: Purchase }) {
  return <section className="purchase-print-sheet" aria-label="采购单打印内容">
    <h1>采购单</h1>
    <div className="purchase-print-meta"><p>单号：{order.number}</p><p>创建时间：{new Date(order.createdAt).toLocaleString('zh-CN')}</p><p>状态：{order.status === 'draft' ? '草稿（未确认）' : order.status === 'pending_approval' ? '待审核（未确认）' : order.status === 'ordered' ? '已确认' : order.status === 'received' ? '已全部入库' : '部分入库'}</p><p>供应商：{order.supplier?.code ? `${order.supplier.code} · ` : ''}{order.supplier?.name ?? '—'}</p></div>
    <table><thead><tr><th>序号</th><th>SKU</th><th>商品</th><th>数量</th><th>单价</th><th>金额</th></tr></thead><tbody>{order.lines.map((line, index) => <tr key={line.id}><td>{index + 1}</td><td>{line.sku}</td><td>{line.name}</td><td>{line.quantity} 件</td><td><Money value={line.unitPrice} /></td><td><Money value={line.lineTotal} /></td></tr>)}</tbody></table>
    <p className="purchase-print-total">合计：<Money value={order.total} /></p><p>备注：{order.note || '—'}</p><p className="purchase-print-footnote">此页为系统业务单据打印件；实际采购履行以双方确认文件为准。</p>
  </section>;
}
