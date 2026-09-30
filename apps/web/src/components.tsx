import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <header className="page-title"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="page-actions">{action}</div>}</header>;
}

export function Notice({ text, tone = 'error' }: { text?: string | null; tone?: 'error' | 'success' | 'info' }) {
  return text ? <div role={tone === 'error' ? 'alert' : 'status'} className={`notice ${tone}`}>{text}</div> : null;
}

export function Empty({ text = '暂无记录' }: { text?: string }) { return <div className="empty">{text}</div>; }
export function Loading() { return <div className="loading" role="status">正在加载…</div>; }
const statusLabels: Record<string, string> = { needs_purchase: '待采购', awaiting_receipt: '待入库', normal: '库存正常', active: '启用', inactive: '停用', draft: '草稿', pending_approval: '待审核', ordered: '已确认', confirmed: '已确认', partial_received: '部分入库', received: '已入库', partial_shipped: '部分出库', shipped: '已出库', open: '未结清', partial: '部分结清', paid: '已结清', in: '入库', out: '出库', receipt: '入库', shipment: '出库', stocktake: '盘点', low_stock: '低库存', discovery: '发现', proposal: '方案', won: '赢单', lost: '输单', pending: '待确认', running: '处理中', completed: '已完成', failed: '失败', configured: '等待连通', connected: '长连接已建立', reconnecting: '重新连接中', error: '连接异常' };
export function Status({ value }: { value: string }) { return <span className={`status status-${value}`}>{statusLabels[value] ?? value.replaceAll('_', ' ')}</span>; }
export function Money({ value }: { value: string | number }) { return <span className="money">¥{Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>; }

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ConfirmDialog({ open, title, description, busy, onCancel, onConfirm }: { open: boolean; title: string; description: ReactNode; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); if (!open && dialog.open) dialog.close(); }, [open]);
  return <dialog ref={ref} onClose={onCancel} className="confirm-dialog" aria-labelledby={titleId}><h2 id={titleId}>{title}</h2><div>{description}</div><div className="dialog-actions"><button type="button" onClick={onCancel} disabled={busy}>取消</button><button type="button" className="primary" onClick={onConfirm} disabled={busy}>{busy ? '正在处理…' : '确认执行'}</button></div></dialog>;
}

export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(total / size));
  return <div className="pager"><span>共 {total} 条 · 第 {page}/{last} 页</span><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button><button type="button" disabled={page >= last} onClick={() => onPage(page + 1)}>下一页</button></div>;
}
