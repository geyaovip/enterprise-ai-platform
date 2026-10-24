import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { UserRound, Building2, Monitor, LayoutGrid, LogOut, ChevronUp, ChevronDown } from 'lucide-react';

type IconName = 'account' | 'company' | 'workspace' | 'operator' | 'logout';
export function UserMenuIcon({ name }: { name: IconName }) {
  const icons = { account: UserRound, company: Building2, workspace: Monitor, operator: LayoutGrid, logout: LogOut };
  const Icon=icons[name]; return <Icon size={18} aria-hidden="true"/>;
}

export function UserMenu({ name, email, subtitle, closeKey, onLogout, children, trailingAction }: {
  name: string; email: string; subtitle: string; closeKey: string;
  onLogout: () => Promise<void>; children: ReactNode; trailingAction?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const nickname = name.trim() || '企业成员';
  const initial = Array.from(nickname)[0].toLocaleUpperCase();
  useEffect(() => { setOpen(false); }, [closeKey]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a[href], button')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      setOpen(false); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const logout = async () => {
    setBusy(true); setError('');
    try { await onLogout(); }
    catch { setError('退出登录失败，请重试。'); }
    finally { setBusy(false); }
  };
  return <div className="account-dock"><div className="user-menu" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    {open && <div id={id} ref={panel} className="user-menu-panel" role="region" aria-label="账号菜单">
      <div className="user-menu-heading"><strong title={nickname}>{nickname}</strong><span title={email}>{email}</span></div>
      <div className="user-menu-links" onClick={event => {
        if ((event.target as Element).closest('a')) setOpen(false);
      }}>{children}</div>
      <div className="user-menu-exit"><button type="button" onClick={() => void logout()} disabled={busy}><UserMenuIcon name="logout" />{busy ? '正在退出…' : '退出登录'}</button></div>
      {error && <p className="user-menu-error" role="alert">{error}</p>}
    </div>}
    <button type="button" ref={trigger} className="user-menu-trigger" aria-label={`${nickname}，账号菜单`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <span className="user-avatar" aria-hidden="true">{initial}</span>
      <span className="user-menu-identity"><strong title={nickname}>{nickname}</strong><span title={subtitle}>{subtitle}</span></span>
      {open ? <ChevronUp size={16} aria-hidden="true"/> : <ChevronDown size={16} aria-hidden="true"/>}
    </button>
  </div>{trailingAction}</div>;
}
