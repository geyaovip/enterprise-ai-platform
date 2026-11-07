import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { Notice, Loading } from '../components';
import { AuthScreen } from '@suite/frontend/auth-screen';
type Info = { email: string; name: string; kind: string; tenantName: string; expiresAt: string };
export function JoinPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const [info, setInfo] = useState<Info | null>(null), [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const refresh = async () => { await api.get('/me'); setAuthenticated(true); };
  useEffect(() => {
    void api.post<Info>('/auth/invitation/inspect', { token }).then(setInfo).catch(e => setError(errorText(e)));
    void api.get('/me').then(() => setAuthenticated(true)).catch(() => {}).finally(() => setChecked(true));
  }, [token]);
  if (info && checked && !authenticated) return <AuthScreen title="登录并加入企业" initialEmail={info.email.includes('@') ? info.email : ''} onLogin={refresh}/>;
  return <main className="login-layout"><section className="login-card"><div className="brand">知行方舟</div><h1>加入企业</h1><Notice text={error}/>
    {done ? <><p>已加入 {info?.tenantName}</p><a className="button primary" href="/tenants">进入工作台</a></> : !info || !checked ? error ? <p>请联系管理员重新生成邀请。</p> : <Loading/> : info.kind === 'recovery' ? <><p>请使用受邀邮箱的验证码登录。</p><a href="/login">前往登录</a></> : <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(null); try { await api.post('/auth/invitation/accept', { token }); window.history.replaceState(null, '', '/join'); setDone(true); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }}><p>{info.tenantName} · {info.name}</p><p>受邀账号：{info.email}</p><button className="primary wide" disabled={busy}>{busy ? '加入中…' : '确认加入'}</button></form>}
  </section></main>;
}
