import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, ArrowLeft, ArrowUpRight, Check, RefreshCw, ChevronRight } from 'lucide-react';
import { api, erpApi, tenantApi, errorText, ApiError } from './api';
import { Dialog, Empty, Loading, Notice, Pager } from './components';
import type { TenantMembership, TenantApp, Page } from './types';

type Notification = { id: string; title: string; body: string; dedupeKey: string; readAt: string | null; createdAt: string; workflowStatus?:string;kind?:string;resourceId?:string;appId?:string;relatedResource?:{type:string;id:string} };
type NotificationPage = Page<Notification> & { unread: number };
type Summary = { enabled: boolean; unread: number };
const pageSize = 20;
export const notificationChangedEvent = 'suite:notifications-changed';

/** Route known event types to their owning application; destinations recheck access. */
export function notificationDestination(item: Notification, tenantKey: string, workspace: string) {
  const base = `${workspace}/t/${encodeURIComponent(tenantKey)}/erp`;
  const uuidResource=/^[0-9a-f-]{36}$/i.test(item.resourceId??'')?item.resourceId:null;
  if(item.kind==='conversation'&&uuidResource&&['tenant_admin','platform_admin'].includes(item.appId??''))return `${workspace}/t/${encodeURIComponent(tenantKey)}/${item.appId==='tenant_admin'?'management-ai':'platform-ai'}?conversation=${uuidResource}`;
  if(item.appId==='crm'&&uuidResource&&['crm-task','crm-import','conversation'].includes(item.kind??''))return `${workspace}/t/${encodeURIComponent(tenantKey)}/crm/${item.kind==='crm-task'?'tasks/':item.kind==='crm-import'?'imports/':'ai?conversation='}${uuidResource}`;
  if(item.kind==='conversation'&&uuidResource)return `${workspace}/t/${encodeURIComponent(tenantKey)}/erp/ai?conversation=${uuidResource}`;
  if(item.kind==='ai-task'&&uuidResource)return `${workspace}/t/${encodeURIComponent(tenantKey)}/tasks?aiTask=${uuidResource}`;
  if(item.kind==='business-task'&&uuidResource)return `${workspace}/t/${encodeURIComponent(tenantKey)}/tasks?task=${uuidResource}`;
  if(item.relatedResource&&/^[0-9a-f-]{36}$/i.test(item.relatedResource.id)){if(item.relatedResource.type==='receipt')return `${base}/receipts?focus=${item.relatedResource.id}`;if(item.relatedResource.type==='opportunity')return `${base}/opportunities?focus=${item.relatedResource.id}`;}
  const [kind, id] = item.dedupeKey.split(':');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const recordId = uuid.test(id ?? '') ? encodeURIComponent(id) : null;
  if ((kind === 'sales' || kind === 'purchase') && id === 'return') return `${base}/returns`;
  if (kind === 'workflow' && recordId) return `${base}/workflows?focus=${recordId}`;
  if (kind === 'contract' && recordId) return `${base}/contracts/${recordId}`;
  if (kind === 'purchase' && recordId) return `${base}/purchases/${recordId}`;
  if (kind === 'purchase-change') return `${base}/purchases`;
  if (kind === 'invoice'&&recordId) return `${base}/invoices?focus=${recordId}`;
  if (kind === 'receipt-claim') return `${base}/receipts`;
  if (kind === 'sales' && id === 'change') {
    const contractId = item.dedupeKey.split(':')[2];
    if (uuid.test(contractId ?? '')) return `${base}/contracts/${encodeURIComponent(contractId)}`;
  }
  if(kind==='account_due'){const parts=item.dedupeKey.split(':');if(uuid.test(parts[2]??''))return `${base}/finance?kind=${parts[1]==='receivable'?'receivables':'payables'}&focus=${parts[2]}`;}
  if (['followup_due'].includes(kind)) return `${base}/work-items`;
  if(kind==='operating'&&recordId)return `${base}/operating-events?focus=${recordId}`;
  if(kind==='support')return `${workspace}/tenant-admin/t/${encodeURIComponent(tenantKey)}/commercial`;
  if (['task','task_due'].includes(kind)&&recordId)return `${base}/collaboration?task=${recordId}`;
  if (kind === 'task') return `${base}/collaboration?q=${encodeURIComponent(item.title.replace(/^.*?[：:]/, ''))}`;
  return `${base}/collaboration?tab=notifications`;
}

export function NotificationCenter({ memberships, workspaceUrl = '', closeKey, onOpen, onNavigate }: {
  memberships: TenantMembership[]; workspaceUrl?: string; closeKey: string;
  onOpen?: () => void; onNavigate?: () => void;
}) {
  const sourceKey = memberships.map(m => m.id).join(':');
  const sources = useMemo(() => memberships, [sourceKey]);
  const [open, setOpen] = useState(false);
  const [tenantKey, setTenantKey] = useState(sources[0]?.tenant.slug ?? '');
  const [page, setPage] = useState(1);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [summaryError, setSummaryError] = useState('');
  const [data, setData] = useState<NotificationPage | null>(null);
  const [detail, setDetail] = useState<Notification | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState('');
  const center = useRef<HTMLDivElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const summaryVersion = useRef(0);
  const listVersion = useRef(0);
  const readVersion = useRef(0);
  const unread = Object.values(summaries).reduce((sum, source) => sum + source.unread, 0);
  const workspace = workspaceUrl.replace(/\/$/, '');

  const refreshSummary = useCallback(async () => {
    const version = ++summaryVersion.current;
    const results = await Promise.allSettled(sources.map(async source => {
      const apps = await api.get<TenantApp[]>(tenantApi(source.tenant.slug, '/apps'));
      const enabled = source.role === 'admin' || apps.some(app => app.granted && app.enabled);
      const result = enabled ? await api.get<NotificationPage>(tenantApi(source.tenant.slug, '/notifications?page_size=1')) : null;
      return { key: source.tenant.slug, enabled, unread: result?.unread ?? 0 };
    }));
    if (version !== summaryVersion.current) return;
    const next: Record<string, Summary> = {};
    const failures: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') next[result.value.key] = result.value;
      else {
        if (result.reason instanceof ApiError && [401, 403].includes(result.reason.status)) next[sources[i].tenant.slug] = { enabled: false, unread: 0 };
        failures.push(`${sources[i].tenant.name}：${errorText(result.reason)}`);
      }
    });
    setSummaries(previous => ({ ...previous, ...next }));
    setSummaryError(failures.join('；'));
  }, [sources]);

  const loadList = useCallback(async () => {
    const version = ++listVersion.current;
    setLoading(true); setError(''); setData(null);
    try {
      const apps = await api.get<TenantApp[]>(tenantApi(tenantKey, '/apps'));
      if (!apps.some(app => app.enabled && app.granted)) {
        if (version === listVersion.current) {
          setData({ items: [], total: 0, unread: 0, page: 1, page_size: pageSize });
          setSummaries(previous => ({ ...previous, [tenantKey]: { enabled: false, unread: 0 } }));
        }
        return;
      }
      const result = await api.get<NotificationPage>(tenantApi(tenantKey, `/notifications?page=${page}&page_size=${pageSize}`));
      if (version !== listVersion.current) return;
      setData(result);
      setSummaries(previous => ({ ...previous, [tenantKey]: { enabled: true, unread: result.unread } }));
    } catch (e) { if (version === listVersion.current) setError(errorText(e)); }
    finally { if (version === listVersion.current) setLoading(false); }
  }, [tenantKey, page]);

  useEffect(() => {
    setSummaries({}); setTenantKey(sources[0]?.tenant.slug ?? '');
    void refreshSummary();
    const refresh = () => { if (!document.hidden) void refreshSummary(); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener(notificationChangedEvent, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      ++summaryVersion.current; ++listVersion.current; ++readVersion.current;
      window.clearInterval(timer); window.removeEventListener('focus', refresh);
      window.removeEventListener(notificationChangedEvent, refresh); document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshSummary, sources]);
  useEffect(() => { setOpen(false); setDetail(null); ++readVersion.current; setReading(''); }, [closeKey, sourceKey]);
  useEffect(() => { ++readVersion.current; setReading(''); setDetail(null); }, [tenantKey]);
  useEffect(() => { if (detail) detailHeading.current?.focus(); }, [detail?.id]);
  useEffect(() => {
    if (!open) return;
    const dialog = center.current?.closest('dialog');
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog?.open) return;
      const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length > 0);
      const first = items[0], last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [open]);
  useEffect(() => {
    if (open && tenantKey) void loadList();
    return () => { ++listVersion.current; };
  }, [open, loadList]);

  const read = async (item: Notification) => {
    if (item.readAt || reading) return;
    const version = ++readVersion.current;
    setReading(item.id); setError('');
    try {
      await api.post(tenantApi(tenantKey, `/notifications/${encodeURIComponent(item.id)}/read`), {});
      window.dispatchEvent(new Event(notificationChangedEvent));
      if (version !== readVersion.current) return;
      const readAt = new Date().toISOString();
      setData(previous => previous ? { ...previous, unread: Math.max(0, previous.unread - 1), items: previous.items.map(n => n.id === item.id ? { ...n, readAt } : n) } : previous);
      setDetail(previous => previous?.id === item.id ? { ...previous, readAt } : previous);
    } catch (e) { if (version === readVersion.current) setError(errorText(e)); }
    finally { if (version === readVersion.current) setReading(''); }
  };
  const close = () => { setOpen(false); setDetail(null); ++readVersion.current; setReading(''); };
  return <>
    <button type="button" className="notification-trigger" aria-label={`通知${unread ? `，${unread} 条未读` : ''}${summaryError ? '，暂时无法更新' : ''}`} title="通知" aria-haspopup="dialog" onClick={() => {
      const preferred = sources.find(source => (summaries[source.tenant.slug]?.unread ?? 0) > 0) ?? sources[0];
      if (preferred) setTenantKey(preferred.tenant.slug);
      onOpen?.(); setPage(1); setDetail(null); setError(''); setOpen(true); void refreshSummary();
    }}><Bell size={20} aria-hidden="true"/>{unread > 0 && <span className="notification-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}</button>
    {createPortal(<Dialog open={open} title={detail ? '通知详情' : '通知'} onClose={close}>
      <div className="notification-center" ref={center}>
        {detail ? <>
          <button type="button" className="notification-back" onClick={() => { setDetail(null); setError(''); }}><ArrowLeft size={16} aria-hidden="true"/>返回通知列表</button>
          <article className="notification-detail"><h3 ref={detailHeading} tabIndex={-1}>{detail.title}</h3><p className="notification-meta">{new Date(detail.createdAt).toLocaleString('zh-CN')} · {detail.readAt ? '已读' : '未读'}</p><p className="notification-body">{detail.workflowStatus&&<span className="subline">当前流转：{({active:'进行中',completed:'已完成',rejected:'已退回',withdrawn:'已撤回',exception:'待重新分配',removed:'已清理'} as Record<string,string>)[detail.workflowStatus]??detail.workflowStatus}</span>}{detail.body || '—'}</p></article>
          <Notice text={error} />
          <div className="notification-detail-actions">
            {!detail.readAt && <button disabled={Boolean(reading)} onClick={() => void read(detail)}><Check size={16}/>{reading ? '正在标记…' : '标为已读'}</button>}
            <a className="notification-business-link" href={notificationDestination(detail, tenantKey, workspace)} onClick={() => { close(); onNavigate?.(); }}>查看相关业务<ArrowUpRight size={16} aria-hidden="true"/></a>
          </div>
        </> : <>
          <div className="notification-toolbar">
            {sources.length > 1 ? <label>企业<select aria-label="通知所属企业" value={tenantKey} onChange={event => { setTenantKey(event.target.value); setPage(1); setError(''); }}>
              {sources.map(source => <option key={source.id} value={source.tenant.slug}>{source.tenant.name}{summaries[source.tenant.slug]?.unread ? ` (${summaries[source.tenant.slug].unread})` : ''}</option>)}
            </select></label> : <span>{sources[0]?.tenant.name ?? '通知'}</span>}
            <button type="button" disabled={loading || !sources.length} onClick={() => { void loadList(); void refreshSummary(); }}><RefreshCw size={16} aria-hidden="true"/>刷新</button>
          </div>
          <Notice text={error || summaryError} />
          {loading ? <Loading/> : error ? <Empty text="通知加载失败，请重试。"/> : !data?.items.length ? <div className="notification-empty"><Bell size={32} aria-hidden="true"/><strong>{summaries[tenantKey]?.enabled === false ? '业务通知未启用' : '暂无通知'}</strong></div> : <>
            <p className="notification-count">{data.unread ? `${data.unread} 条未读` : '全部已读'}</p>
            <ul className="notification-center-list">{data.items.map(item => <li key={item.id}>
              <button className={`notification-item ${item.readAt ? '' : 'unread'}`} type="button" onClick={() => { setDetail(item); setError(''); void read(item); }}>
                <span className="notification-status-dot" aria-hidden="true"/><span className="notification-item-copy"><strong>{item.title}</strong><span>{item.body || '—'}</span><small>{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.readAt ? '已读' : '未读'}</small></span><ChevronRight size={16} aria-hidden="true"/>
              </button>
            </li>)}</ul>
            <Pager page={page} total={data.total} size={pageSize} onPage={setPage}/>
          </>}
        </>}
      </div>
    </Dialog>, document.body)}
  </>;
}
