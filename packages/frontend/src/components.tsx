import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode, InputHTMLAttributes } from 'react';
import { DropdownSelect } from './DropdownSelect';
export { UserMenu, UserMenuIcon } from './UserMenu';
export { InfoTip } from './InfoTip';
export { RecordActions } from './RecordActions';
export { SearchSelect } from './SearchSelect';
export { ChoiceSelect } from './ChoiceSelect';
export { DropdownSelect };
export { EntitySelect } from './EntitySelect';
export { NotificationCenter } from './NotificationCenter';
export { ApplicationSwitcher } from './ApplicationSwitcher';
export type { ApplicationChoice } from './ApplicationSwitcher';
export { LayoutGrid as ApplicationIcon } from 'lucide-react';
export { ChevronDown, Download, FolderOpen, Search } from 'lucide-react';
export { BrandLogo, BrandIdentity, ErpApplicationIcon, CrmApplicationIcon, MesApplicationIcon } from './BrandLogo';
export { NavIcon, ShellBrand, ShellToolbar, AddIcon, ForwardIcon, MenuIcon } from './ErpShell';
export { AiDialog } from './AiDialog';
export { Sparkles, Send, X, ClipboardList, Boxes, ChartNoAxesCombined, FileText } from 'lucide-react';
import { Plus, X, Eye, EyeOff, ArrowLeft } from 'lucide-react';
export { PagedCollection } from './PagedCollection';

export function PageTitle({ title, subtitle, action, back }: { title: string; subtitle?: string; action?: ReactNode; back?: ReactNode }) {
  const anchor = useRef<HTMLElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<string | null>(null);
  const titleId = useId();
  const [titleHost, setTitleHost] = useState<Element | null>(null);
  const [docked, setDocked] = useState(false);
  const secondary = Boolean(back);
  useLayoutEffect(() => {
    document.title = `${title} · 知行方舟`;
    const shell = anchor.current?.closest<HTMLElement>('.app-shell');
    const toolbar = shell?.querySelector<HTMLElement>('.suite-topbar');
    const slot = anchor.current?.querySelector<HTMLElement>('.page-heading-slot');
    if (!shell || !toolbar || !slot) return;
    setTitleHost(toolbar.querySelector('.suite-topbar-title'));
    shell.dataset.pageTitle = titleId;
    shell.dataset.secondary = String(secondary);
    const mobile = window.matchMedia('(max-width:767px)');
    let frame = 0;
    let previous = false;
    const update = () => {
      frame = 0;
      if (mobile.matches) slot.style.minHeight = '0px';
      else if (line.current?.parentElement === slot) slot.style.minHeight = `${line.current.offsetHeight}px`;
      const next = mobile.matches || slot.getBoundingClientRect().bottom <= toolbar.getBoundingClientRect().bottom;
      if (next !== previous && line.current?.contains(document.activeElement)) restoreFocus.current = (document.activeElement as HTMLElement).id;
      previous = next;
      shell.dataset.titleDocked = String(next);
      setDocked(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(slot); observer.observe(toolbar);
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    mobile.addEventListener('change', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      mobile.removeEventListener('change', schedule);
      if (shell.dataset.pageTitle === titleId) { delete shell.dataset.pageTitle; delete shell.dataset.secondary; delete shell.dataset.titleDocked; }
    };
  }, [title, titleId, secondary]);
  useEffect(() => { if (restoreFocus.current) { document.getElementById(restoreFocus.current)?.focus({preventScroll:true}); restoreFocus.current = null; } }, [docked]);
  let backControl = back;
  if (isValidElement<{ children?: ReactNode; className?: string; id?: string; 'aria-label'?: string; title?: string }>(back)) {
    const text = Children.toArray(back.props.children).filter(child => typeof child === 'string').join('').trim().replace(/^←\s*/, '') || '返回上一级';
    backControl = cloneElement(back, { id: back.props.id ?? `${titleId}-back`, className: 'page-back', 'aria-label': back.props['aria-label'] ?? text, title: text, children: <ArrowLeft size={22} aria-hidden="true"/> });
  }
  const heading = <div ref={line} className="page-heading-line">{backControl}<h1 id={titleId} title={title}>{title}</h1></div>;
  return <header ref={anchor} className="page-title"><div className="page-title-meta"><div className="page-heading-slot">{docked && titleHost ? createPortal(heading, titleHost) : heading}</div>{subtitle && <p>{subtitle}</p>}</div><div className="page-actions">{action}</div></header>;
}

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return <span className="password-input"><input {...props} type={visible ? 'text' : 'password'} /><button type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} disabled={props.disabled} onClick={event => { event.preventDefault(); setVisible(value => !value); }}>{visible ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}</button></span>;
}

const DialogFooterContext = createContext<HTMLElement | null>(null);

/** Dock the real primary action in the modal footer. The HTML form attribute
 * preserves native submit/validation even though the button is portaled. */
export function DialogAction({ children, replacesClose = false }: { children: ReactNode; replacesClose?: boolean }) {
  const footer = useContext(DialogFooterContext);
  const anchor = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [formId, setFormId] = useState<string>();
  useEffect(() => { const form = anchor.current?.closest('form'); if (form) { if (!form.id) form.id = `dialog-form-${id}`; setFormId(form.id); } }, [footer, id]);
  const action = isValidElement<{ form?: string }>(children) ? cloneElement(children, { ...(formId ? { form: formId } : {}) }) : children;
  return footer ? <><span ref={anchor} className="action-anchor" />{createPortal(<div className="dialog-submit-actions" data-replaces-close={replacesClose||undefined}>{action}</div>, footer)}</> : <span ref={anchor} className="dialog-action-inline">{children}</span>;
}

/** One accessible modal contract across the three applications. Native dialogs
 * provide focus containment, an inert background and restoration to the opener. */
export function Dialog({ open, title, children, onClose, busy = false, size = 'medium', dirtyCheck = false }: { open: boolean; title: ReactNode; children: ReactNode; onClose: () => void; busy?: boolean; size?: 'medium' | 'large'; dirtyCheck?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [confirmClose, setConfirmClose] = useState(false);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = () => queueMicrotask(() => { if (document.querySelector('dialog[open]')) return; const target = opener.current?.isConnected ? opener.current : ref.current?.closest('main')?.querySelector<HTMLElement>('.page-actions button') ?? document.querySelector<HTMLElement>('main'); target?.focus(); });
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      // Conditional dialogs can unmount while open without an open=false render.
      if (dialog?.open) { dialog.close(); restoreFocus(); }
    };
  }, []);
  const baseline = useRef('');
  const dirty = useRef(false);
  const values = () => JSON.stringify([...ref.current?.querySelectorAll<HTMLInputElement>('input:not([type=hidden]),select,textarea') ?? []].map(x => [x.type, x.value, x.checked]));
  const requestClose = () => { if (busy) return; if (dirtyCheck && dirty.current && values() !== baseline.current) setConfirmClose(true); else onClose(); };
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    if (open && !dialog.open) { setConfirmClose(false); dirty.current = false; baseline.current = values(); opener.current = document.activeElement as HTMLElement; dialog.showModal(); if (!dialog.querySelector('[autofocus]')) dialog.querySelector<HTMLElement>('.task-dialog-header h2')?.focus({ preventScroll: true }); }
    if (!open && dialog.open) { setConfirmClose(false); dialog.close(); restoreFocus(); }
  }, [open]);
  useEffect(() => {
    if (!open || !dirtyCheck) return;
    const guard = (e: BeforeUnloadEvent) => { if (dirty.current && values() !== baseline.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [open, dirtyCheck]);
  return <dialog ref={ref} className={`task-dialog task-dialog-${size}`} aria-labelledby={titleId} aria-busy={busy || undefined} onInput={() => { dirty.current = true; }} onChange={() => { dirty.current = true; }} onCancel={e => { e.preventDefault(); requestClose(); }}>
    <header className="task-dialog-header"><h2 id={titleId} tabIndex={-1}>{title}</h2><button type="button" className="icon-button" aria-label="关闭弹窗" disabled={busy} onClick={requestClose}><X size={18} aria-hidden="true"/></button></header>
    <DialogFooterContext.Provider value={footer}><div className="task-dialog-body">{children}</div></DialogFooterContext.Provider>
    <footer ref={setFooter} className="task-dialog-footer"><button type="button" className="dialog-close" disabled={busy} onClick={requestClose}>{dirtyCheck ? '取消' : '关闭'}</button></footer>
    <ConfirmDialog open={confirmClose} title="放弃本次修改？" description="修改尚未保存，离开后保留上次已保存的内容。" confirmPrimary={false} cancelLabel="继续编辑" confirmLabel="放弃修改并离开" onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onClose(); }} />
  </dialog>;
}

/** Keep existing domain forms and state intact, with their launch action in the
 * owning page header. Row edits open the same form through a stable openKey. */
export function ActionPanel({ title, label, ariaLabel, children, openKey, successKey, error, busy = false, onNew, onDismiss, placement = 'page', primary = true, size = 'medium' }: { title: ReactNode; label: string; ariaLabel?: string; children: ReactNode; openKey?: unknown; successKey?: unknown; error?: string | null; busy?: boolean; onNew?: () => void; onDismiss?: () => void; placement?: 'page' | 'section' | 'inline'; primary?: boolean; size?: 'medium' | 'large' }) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<Element | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const previousSuccess = useRef(successKey);
  const previousOpen = useRef(openKey);
  useEffect(() => { if (openKey) setOpen(true); else if (previousOpen.current) setOpen(false); previousOpen.current = openKey; }, [openKey]);
  useEffect(() => { if (successKey && successKey !== previousSuccess.current) setOpen(false); previousSuccess.current = successKey; }, [successKey]);
  useEffect(() => { if (placement === 'page') setHost(anchor.current?.closest('main')?.querySelector(':scope > .page-title > .page-actions') ?? null); else if (placement === 'section') setHost(anchor.current?.closest('section')?.querySelector(':scope > .panel-heading > .section-actions') ?? null); }, [placement]);
  const button = <button type="button" aria-label={ariaLabel} className={primary ? 'primary' : undefined} disabled={busy} onClick={() => { onNew?.(); setOpen(true); }}>{primary && <Plus size={16} aria-hidden="true"/>}{label}</button>;
  return <><span ref={anchor} className="action-anchor" />{host ? createPortal(button, host) : <div className="inline-action">{button}</div>}<Dialog open={open} title={title} busy={busy} size={size} dirtyCheck onClose={() => { setOpen(false); onDismiss?.(); }}><Notice text={error} />{children}</Dialog></>;
}

export function TabBar({ label, children }: { label: string; children: ReactNode }) {
  const tabs = Children.toArray(children).filter(isValidElement);
  return <div className="tabs section-tabs" role="tablist" aria-label={label} onKeyDown={event => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]:not(:disabled)')];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    if (index < 0) return;
    event.preventDefault(); buttons[next]?.click(); buttons[next]?.focus();
  }}>{tabs.map(child => {
    const tab = child as React.ReactElement<{ 'aria-selected'?: boolean; 'aria-pressed'?: boolean; tabIndex?: number; role?: string }>;
    const selected = tab.props['aria-selected'] ?? tab.props['aria-pressed'] ?? false;
    return cloneElement(tab, { role: 'tab', 'aria-selected': selected, 'aria-pressed': undefined, tabIndex: selected ? 0 : -1 });
  })}</div>;
}

export function SectionTabs({ label, items, layout = 'tabs', value, onChange }: { label: string; items: Array<{ id: string; label: string; content: ReactNode }>; layout?: 'tabs' | 'settings'; value?: string; onChange?: (id: string) => void }) {
  const [selected, setSelected] = useState(items[0]?.id ?? '');
  const id = useId();
  const active = items.find(x => x.id === (value ?? selected)) ?? items[0];
  const select = (next: string) => { setSelected(next); onChange?.(next); };
  return <div className={layout === 'settings' ? 'settings-layout' : undefined}><div className={layout === 'settings' ? 'tabs settings-menu' : 'tabs section-tabs'} role="tablist" aria-label={label} aria-orientation={layout === 'settings' ? 'vertical' : 'horizontal'}>{items.map((item, index) => <button key={item.id} id={`${id}-${item.id}`} type="button" role="tab" aria-selected={active?.id === item.id} aria-controls={`${id}-panel`} tabIndex={active?.id === item.id ? 0 : -1} className={active?.id === item.id ? 'active' : ''} onClick={() => select(item.id)} onKeyDown={e => { let next = index; if (e.key === 'ArrowRight' || layout === 'settings' && e.key === 'ArrowDown') next = (index + 1) % items.length; else if (e.key === 'ArrowLeft' || layout === 'settings' && e.key === 'ArrowUp') next = (index + items.length - 1) % items.length; else if (e.key === 'Home') next = 0; else if (e.key === 'End') next = items.length - 1; else return; e.preventDefault(); select(items[next].id); document.getElementById(`${id}-${items[next].id}`)?.focus(); }}>{item.label}</button>)}</div><div className={layout === 'settings' ? 'settings-pane' : undefined} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${active?.id}`} key={active?.id}>{active?.content}</div></div>;
}

export function Notice({ text, tone = 'error' }: { text?: string | null; tone?: 'error' | 'success' | 'info' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!text || tone !== 'error') return;
    const frame = requestAnimationFrame(() => {
      if (!ref.current?.closest('dialog[open]')) return;
      ref.current.scrollIntoView({block:'nearest'});
      ref.current.focus({preventScroll:true});
    });
    return () => cancelAnimationFrame(frame);
  }, [text, tone]);
  return text ? <div ref={ref} tabIndex={tone === 'error' ? -1 : undefined} role={tone === 'error' ? 'alert' : 'status'} className={`notice ${tone}`}>{text}</div> : null;
}

export function Empty({ text = '暂无记录', description, action }: { text?: string; description?: string; action?: ReactNode }) { return <div className="empty"><strong>{text}</strong>{description && <p>{description}</p>}{action && <div className="empty-actions">{action}</div>}</div>; }
export function Loading() { return <div className="loading" role="status">正在加载…</div>; }
export function DetailFacts({items}: {items: Array<{label: string; value: ReactNode}>}) {
  return <dl className="detail-facts">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value ?? '—'}</dd></div>)}</dl>;
}
export function DataResult({data, loading, error, reload, children}: {data: unknown; loading: boolean; error?: string | null; reload?: () => Promise<unknown>; children: ReactNode}) {
  if (loading && data == null) return <Loading/>;
  if (error) return <div className="data-load-error"><Notice text={error}/>{reload && <button type="button" disabled={loading} onClick={() => void reload()}>重新加载</button>}</div>;
  if (data == null) return <Empty text="暂无数据"/>;
  return <>{loading && <p className="muted" role="status">正在更新…</p>}{children}</>;
}
const statusLabels: Record<string, string> = { preparing:'正在启动',interrupted:'已中断', awaiting_confirmation:'待确认计划', waiting:'等待办理', queued:'待执行', delivered:'已送达', retry:'待重试', acknowledged:'处理中', revoked:'已撤销', suspended:'已暂停', issued:'待收款', void:'已作废', reserved:'已预留', settled:'已计量', closed:'已关闭',credit:'待退款',sales_return:'销售退货入库',purchase_return:'采购退货出库',transfer:'调拨',opening:'期初',expired:'已过期',accepted:'已接受',reversed:'已冲正', requested: '待财务处理', registered: '已内部登记', withdrawn: '已撤回', voided: '登记已标作废', cancelled: '已取消', needs_purchase: '待采购', awaiting_receipt: '待入库', normal: '库存正常', active: '启用', inactive: '停用', draft: '草稿', pending_approval: '待审核', approved: '已批准', rejected: '已退回', ordered: '已确认', confirmed: '已确认', partial_received: '部分入库', received: '已入库', partial_shipped: '部分出库', shipped: '已出库', open: '未结清', partial: '部分结清', paid: '已结清', in: '入库', out: '出库', receipt: '入库', shipment: '出库', stocktake: '盘点', low_stock: '低库存', discovery: '发现', proposal: '方案', won: '赢单', lost: '输单', pending: '待确认', running: '处理中', result_unknown: '结果待核实', completed: '已完成', failed: '失败', configured: '等待连通', connected: '长连接已建立', reconnecting: '重新连接中', error: '连接异常' };
export function Status({ value, label }: { value: string; label?: string }) { return <span className={`status status-${value}`}>{label ?? statusLabels[value] ?? value.replaceAll('_', ' ')}</span>; }
export function Money({ value }: { value: string | number }) { return <span className="money">¥{Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: Number(value)!==0&&Math.abs(Number(value))<0.01?6:2 })}</span>; }

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const labelId = useId();
  const required = Children.toArray(children).some(child => isValidElement<{ required?: boolean }>(child) && child.props.required);
  const controls = Children.map(children, child => isValidElement<InputHTMLAttributes<HTMLInputElement>>(child)
    && (child.type === PasswordInput || child.type === DropdownSelect)
    && !child.props['aria-label'] ? cloneElement(child, { 'aria-labelledby': child.props['aria-labelledby'] ?? labelId }) : child);
  return <label className="field"><span id={labelId}>{label}{required && <span className="required-mark" aria-hidden="true"> *</span>}</span>{controls}{hint && <small>{hint}</small>}</label>;
}

export function FileUpload({ label, accept, disabled, onFile, hint, buttonLabel }: { label: string; accept: string; disabled?: boolean; onFile: (file: File) => Promise<void>; hint?: string; buttonLabel?: string }) {
  const id = useId();
  const [filename, setFilename] = useState('');
  return <div className="file-upload"><label className="field" htmlFor={id}><span>{label}</span></label><div className={`file-picker ${disabled ? 'disabled' : ''}`}><input id={id} className="file-picker-input" type="file" accept={accept} disabled={disabled} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) { setFilename(file.name); void onFile(file); } }} /><label className="file-picker-button" htmlFor={id}>{disabled ? '正在处理…' : (buttonLabel ?? '选择文件上传')}</label><span className="file-picker-name" aria-live="polite">{filename || hint || '未选择文件'}</span></div></div>;
}

export function ConfirmDialog({ open, title, description, error, busy, confirmDisabled, onCancel, onConfirm, confirmLabel = '确认执行', cancelLabel = '取消', confirmPrimary = true }: { open: boolean; title: string; description: ReactNode; error?: string | null; busy?: boolean; confirmDisabled?: boolean; onCancel: () => void; onConfirm: () => void; confirmLabel?: string; cancelLabel?: string; confirmPrimary?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLButtonElement>('.dialog-actions button')?.focus(); } if (!open && dialog.open) dialog.close(); }, [open]);
  return <dialog ref={ref} onClose={onCancel} onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }} className="confirm-dialog" aria-labelledby={titleId} aria-busy={busy || undefined}><header className="confirm-dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="关闭确认" onClick={onCancel} disabled={busy}><X size={18} aria-hidden="true"/></button></header><div className="confirm-dialog-body"><Notice text={error} />{description}</div><div className="dialog-actions"><button type="button" className={!confirmPrimary ? 'primary' : undefined} autoFocus onClick={onCancel} disabled={busy}>{cancelLabel}</button><button type="button" className={confirmPrimary ? 'primary' : undefined} onClick={onConfirm} disabled={busy || confirmDisabled}>{busy ? '正在处理…' : confirmLabel}</button></div></dialog>;
}

export function Pager({ page, total, size, onPage, label = '列表分页' }: { page: number; total: number; size: number; onPage: (page: number) => void; label?: string }) {
  const count = Math.max(0, Number(total) || 0);
  const last = Math.max(1, Math.ceil(count / Math.max(1, size)));
  const current = Math.max(1, Math.min(last, page));
  useEffect(() => { if (page !== current) onPage(current); }, [page, current, onPage]);
  if (count === 0) return null;
  return <nav className="pager" aria-label={label}><span role="status">共 {count} 条 · 第 {current}/{last} 页</span><button type="button" disabled={current <= 1} onClick={() => onPage(current - 1)} aria-label="上一页">上一页</button><button type="button" disabled={current >= last} onClick={() => onPage(current + 1)} aria-label="下一页">下一页</button></nav>;
}

// All three shells use the same keyboard behavior for the mobile drawer.
export function useNavigationFocus(open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const trigger = document.querySelector<HTMLButtonElement>('.mobile-menu');
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    const content = document.querySelector<HTMLElement>('.content');
    if (!trigger || !sidebar || getComputedStyle(trigger).display === 'none') return;
    const focusables = () => [...sidebar.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')].filter(node => node.getClientRects().length > 0);
    const previousInert = content?.inert ?? false;
    if (content) content.inert = true;
    focusables()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key === 'Tab') {
        const items = focusables(); const first = items[0]; const last = items.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (content) content.inert = previousInert; trigger.focus(); };
  }, [open, setOpen]);
}
