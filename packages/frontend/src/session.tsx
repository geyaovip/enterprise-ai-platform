import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, errorText } from './api';
import { AuthScreen, EnterpriseOnboarding } from './auth-screen';
import { Empty, Loading } from './components';
import type { Me } from './types';

export function SessionApp({ title, children, onLogin }: {
  title: string;
  children: (me: Me, logout: () => Promise<void>) => ReactNode;
  onLogin?: (profile: Me) => void;
}) {
  const [me, setMe] = useState<Me | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const refresh = async (onProfile?: (profile: Me) => void) => {
    try {
      const profile = await api.get<Me>('/me');
      onProfile?.(profile);
      setMe(profile);
      setError(null);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setError(errorText(e));
      setMe(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const logout = async () => { await api.post('/auth/logout'); setMe(null); };
  if (loading) return <Loading />;
  if (!me) return <AuthScreen title={title} onLogin={() => refresh(onLogin)} initialError={error}/>;
  if (!me.tenants.length && !me.platformRole) return <EnterpriseOnboarding workspaceUrl={import.meta.env.VITE_WORKSPACE_URL ?? 'http://127.0.0.1:4601'} onCreated={refresh} onLogout={logout}/>;
  return <Fragment key={me.user.id}>{children(me, logout)}</Fragment>;
}

export function AccessDenied({ onLogout }: { onLogout: () => Promise<void> }) { return <main className="picker"><Empty text="当前账号无权访问此管理端。请使用对应管理账号登录。" /><a className="button primary" href={(import.meta.env.VITE_WORKSPACE_URL ?? 'http://127.0.0.1:4601').replace(/\/$/,'')+'/tenants'}>进入业务工作台</a><button onClick={() => void onLogout()}>切换账号</button></main>; }
