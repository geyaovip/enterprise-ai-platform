import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, Search, X } from 'lucide-react';

type HistoryItem = { id: string; title: string; updatedAt: string };

/** Presentation only. Facts, permissions, streams and writes remain app-owned. */
export function AiDialog({ open, title, history, selected, busy = false, onSelect, onNew, onClose, children, composer }: {
  busy?: boolean; open: boolean; title: string; history: HistoryItem[]; selected: string | null;
  onSelect: (id: string) => void; onNew: () => void; onClose: () => void;
  children: ReactNode; composer: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const titleButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mobile, setMobile] = useState(false);
  const historyId = useId();
  const callbacks = useRef({ onClose }); callbacks.current = { onClose };
  useEffect(() => {
    if (!open) { setHistoryOpen(false); return; }
    opener.current = document.activeElement as HTMLElement;
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const originalInert = shell?.inert ?? false;
    const overflow = document.body.style.overflow;
    const update = () => {
      const isMobile = window.matchMedia('(max-width:767px)').matches;
      setMobile(isMobile);
      if (shell) shell.inert = isMobile || originalInert;
      document.body.style.overflow = isMobile ? 'hidden' : overflow;
      const viewport = window.visualViewport;
      panel.current?.style.setProperty('--chat-height', `${viewport?.height ?? window.innerHeight}px`);
      panel.current?.style.setProperty('--chat-top', `${viewport?.offsetTop ?? 0}px`);
    };
    update(); titleButton.current?.focus();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      if (shell) shell.inert = originalInert;
      document.body.style.overflow = overflow;
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (historyOpen) { setHistoryOpen(false); titleButton.current?.focus(); }
        else callbacks.current.onClose();
      }
      if (event.key === 'Tab' && mobile) {
        const items = [...panel.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? []].filter(x => x.getClientRects().length > 0);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [open, historyOpen, mobile]);
  useEffect(() => {
    if (!open || !historyOpen) return;
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest('.ai-history-menu,.ai-title-button')) setHistoryOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, historyOpen]);
  useEffect(() => { if (historyOpen) searchInput.current?.focus(); }, [historyOpen]);
  if (!open) return null;
  const rows = history.filter(item => item.title.toLowerCase().includes(query.trim().toLowerCase()));
  const today = new Date().toLocaleDateString('sv-SE');
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
  const groups = ['今天', '昨天', '更早'].map(label => ({ label, items: rows.filter(item => {
    const date = new Date(item.updatedAt).toLocaleDateString('sv-SE');
    return (date === today ? '今天' : date === yesterday ? '昨天' : '更早') === label;
  }) }));
  return createPortal(<section className="suite-ai-panel" ref={panel} role="dialog" aria-label="AI 对话" aria-modal={mobile || undefined} onPointerDown={event => {
    if (historyOpen && !(event.target as Element).closest('.ai-history-menu,.ai-title-button')) setHistoryOpen(false);
  }}>
    <header className="ai-panel-header"><button type="button" ref={titleButton} className="ai-title-button" aria-label="查看历史对话" aria-haspopup="dialog" aria-expanded={historyOpen} aria-controls={historyOpen ? historyId : undefined} onClick={() => { setHistoryOpen(value => !value); setQuery(''); }}><span title={title}>{title}</span><ChevronDown size={16} aria-hidden="true"/></button><div className="ai-header-actions"><button type="button" className="icon-button" aria-label="新建对话" disabled={busy} onClick={() => { setHistoryOpen(false); onNew(); }}><Plus size={20} aria-hidden="true"/></button><button type="button" className="icon-button" aria-label="关闭 AI 对话" onClick={onClose}><X size={20} aria-hidden="true"/></button></div></header>
    {historyOpen && <div className="ai-history-menu" id={historyId} role="dialog" aria-label="历史对话"><label className="ai-history-search"><span className="sr-only">搜索对话</span><input ref={searchInput} type="search" placeholder="搜索对话…" value={query} onChange={event => setQuery(event.target.value)}/><Search size={18} aria-hidden="true"/></label><div className="ai-history-list">{groups.map(group => group.items.length > 0 && <section key={group.label}><h3>{group.label}</h3>{group.items.map(item => <button type="button" disabled={busy} className={`ai-history-row${selected === item.id ? ' selected' : ''}`} key={item.id} title={item.title} onClick={() => { setHistoryOpen(false); onSelect(item.id); }}><span>{item.title}</span><time>{new Date(item.updatedAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</time></button>)}</section>)}{!rows.length && <p className="ai-history-empty">{query ? '没有匹配的对话' : '还没有历史对话'}</p>}</div><button type="button" disabled={busy} onClick={() => { setHistoryOpen(false); onNew(); }}><Plus size={16} aria-hidden="true"/>新对话</button></div>}
    <div className="ai-panel-content">{children}</div><div className="ai-panel-composer">{composer}</div>
  </section>, document.body);
}
