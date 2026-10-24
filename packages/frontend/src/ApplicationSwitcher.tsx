import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, ChevronDown, Search, X } from 'lucide-react';

export type ApplicationChoice = { id: string; name: string; shortName: string; description: string; icon: ReactNode; href: string };

/** Application identity and launcher; consumers supply only authorized applications. */
export function ApplicationSwitcher({ apps, currentId, recentIds, compact = false }: {
  apps: ApplicationChoice[]; currentId: string; recentIds: string[]; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const current = apps.find(app => app.id === currentId);
  useEffect(() => {
    if (open) { ref.current?.showModal(); search.current?.focus(); }
    else if (ref.current?.open) { ref.current.close(); trigger.current?.focus(); }
  }, [open]);
  useEffect(() => { setOpen(false); }, [currentId]);
  if (!current) return null;
  const matches = apps.filter(app => `${app.name} ${app.shortName} ${app.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const recent = query.trim() ? [] : recentIds.map(value => apps.find(app => app.id === value)).filter((app): app is ApplicationChoice => !!app).slice(0, 3);
  const row = (app: ApplicationChoice) => <Link key={app.id} to={app.href} className={`application-choice${app.id === currentId ? ' is-current' : ''}`} aria-current={app.id === currentId ? 'true' : undefined} onClick={() => setOpen(false)}>
    <span className={`application-icon application-icon-${app.id}`} aria-hidden="true">{app.icon}</span>
    <span className="application-choice-copy"><strong>{app.name}</strong></span>
    {app.id === currentId ? <span className="application-current"><Check size={14} aria-hidden="true"/>当前</span> : <span className="application-enter">进入<ArrowUpRight size={14} aria-hidden="true"/></span>}
  </Link>;
  return <div className={compact ? 'application-launcher is-compact' : 'application-launcher'}>
    <button ref={trigger} type="button" className="application-trigger" aria-label={`当前应用：${current.name}，切换应用`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => { setQuery(''); setOpen(true); }}>
      <span className={`application-icon application-icon-${current.id}`} aria-hidden="true">{current.icon}</span>
      <span className="application-trigger-copy"><strong>{compact ? current.shortName : current.name}</strong></span>
      <ChevronDown size={15} aria-hidden="true"/>
    </button>
    {createPortal(<dialog ref={ref} id={id} className="application-picker" aria-labelledby={`${id}-title`} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setOpen(false);
    }}>
      <header className="application-picker-heading"><div><h2 id={`${id}-title`}>切换应用</h2></div><button type="button" aria-label="关闭应用选择" onClick={() => setOpen(false)}><X size={18} aria-hidden="true"/></button></header>
      <label className="application-search"><Search size={18} aria-hidden="true"/><input ref={search} aria-label="搜索应用" placeholder="搜索应用" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="application-picker-body">
        {recent.length > 0 && <section aria-label="最近使用"><h3>最近使用</h3><div className="application-recents">{recent.map(app => <Link key={app.id} to={app.href} onClick={() => setOpen(false)} aria-label={`进入${app.name}`}><span className={`application-icon application-icon-${app.id}`} aria-hidden="true">{app.icon}</span><strong>{app.name}</strong>{app.id === currentId && <small>当前使用</small>}</Link>)}</div></section>}
        <section aria-label="企业已开通"><h3>{query.trim() ? `搜索结果 · ${matches.length}` : `企业已开通 · ${apps.length}`}</h3>{matches.map(row)}{!matches.length && <p className="application-no-results" role="status">没有找到相关应用，请试试其他名称</p>}</section>
      </div>
      
    </dialog>, document.body)}
  </div>;
}
