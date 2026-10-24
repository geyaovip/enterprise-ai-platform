import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, errorText } from './api';
import { Field, Notice, PasswordInput } from './components';
import { BrandLogo } from './BrandLogo';

export function AuthScreen({ title, onLogin, initialError }: { title: string; onLogin: () => Promise<void>; initialError?: string | null }) {
  const location = useLocation(); const navigate = useNavigate(); const register = location.pathname === '/register';
  const [account, setAccount] = useState(''); const [password, setPassword] = useState(''); const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(initialError ?? null); const [success, setSuccess] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setError(null); setSuccess(null);
    if (register && password !== repeat) { setError('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      if (register) { await api.post('/auth/register', { account, password }); setPassword(''); setRepeat(''); setSuccess('注册成功，请登录'); navigate('/login', { replace: true }); }
      else { await api.post('/auth/login', { account, password }); setPassword(''); await onLogin(); }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const switchMode = () => { setError(null); setSuccess(null); setPassword(''); setRepeat(''); };
  return <main className="login-layout"><form className="login-card" onSubmit={submit}><a className="brand auth-brand" href="/" aria-label="知行方舟首页"><BrandLogo size={36}/><span>知行方舟</span></a><h1>{register ? '注册账号' : title}</h1><Notice text={error}/><Notice tone="success" text={success}/><Field label="账号"><input autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={register ? 4 : undefined} maxLength={register ? 40 : 254} pattern={register ? '[a-zA-Z0-9][a-zA-Z0-9_-]*' : undefined} value={account} onChange={e => setAccount(e.target.value)} placeholder={register ? '4–40 位字母、数字、下划线或短横线' : '请输入账号'}/></Field><Field label={register ? '密码（至少 12 位）' : '密码'}><PasswordInput autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : undefined} maxLength={200} value={password} onChange={e => setPassword(e.target.value)}/></Field>{register && <Field label="确认密码"><PasswordInput autoComplete="new-password" required maxLength={200} value={repeat} onChange={e => setRepeat(e.target.value)}/></Field>}<button className="primary wide" disabled={busy}>{busy ? register ? '注册中…' : '登录中…' : register ? '注册' : '登录'}</button><p className="auth-switch">{register ? '已有账号？' : '还没有账号？'} <Link aria-disabled={busy} onClick={e => { if (busy) e.preventDefault(); else switchMode(); }} to={register ? '/login' : '/register'}>{register ? '前往登录' : '注册账号'}</Link></p></form></main>;
}

export function EnterpriseOnboarding({ workspaceUrl, onCreated, onLogout }: { workspaceUrl: string; onCreated: () => Promise<void>; onLogout: () => Promise<void> }) {
  const [name, setName] = useState(''); const [invitation, setInvitation] = useState(''); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => { e.preventDefault(); if (busy) return; setBusy(true); setError(null); try { const result = await api.post<{tenant:{slug:string}}>('/onboarding/enterprise', { name }); await onCreated(); window.location.assign(workspaceUrl.replace(/\/$/, '') + '/t/' + encodeURIComponent(result.tenant.slug)); } catch (e) { setError(errorText(e)); setBusy(false); } };
  const join = (e: FormEvent) => { e.preventDefault(); try { const url = new URL(invitation); const token = new URLSearchParams(url.hash.slice(1)).get('token'); if (!token || token.length < 32 || token.length > 200 || !url.pathname.endsWith('/join')) throw new Error('请粘贴管理员提供的完整邀请链接'); window.location.assign(workspaceUrl.replace(/\/$/, '') + '/join#token=' + encodeURIComponent(token)); } catch { setError('请粘贴管理员提供的完整邀请链接'); } };
  return <main className="picker onboarding"><div className="panel"><h1>开始使用 ERP</h1><Notice text={error}/><form onSubmit={create}><h2>创建企业</h2><Field label="企业名称"><input required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="请输入企业名称"/></Field><button className="primary" disabled={busy}>{busy ? '创建中…' : '创建并进入企业'}</button></form><form onSubmit={join}><h2>加入已有企业</h2><Field label="邀请链接"><input type="url" required maxLength={1000} value={invitation} onChange={e => setInvitation(e.target.value)} placeholder="粘贴管理员提供的邀请链接"/></Field><button disabled={busy}>继续接受邀请</button></form><button className="text-button" disabled={busy} onClick={() => void onLogout()}>退出登录</button></div></main>;
}
