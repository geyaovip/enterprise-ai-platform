import { Turnstile, type TurnstileHandle } from './Turnstile';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, errorText } from './api';
import { Field, Notice } from './components';
import { BrandLogo } from './BrandLogo';

export function AuthScreen({ title, onLogin, initialError, initialEmail = '', bindExisting = false }: { title: string; onLogin: () => Promise<void>; initialError?: string | null; initialEmail?: string; bindExisting?: boolean }) {
  const location = useLocation(), navigate = useNavigate();
  const codeId = useId();
  const [email, setEmail] = useState(initialEmail), [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null), [sentEmail, setSentEmail] = useState(''), [retryAt, setRetryAt] = useState(0), [seconds, setSeconds] = useState(0);
  const [verifyRetryAt, setVerifyRetryAt] = useState(0), [verifySeconds, setVerifySeconds] = useState(0);
  const [action, setAction] = useState<'send' | 'verify' | null>(null), [error, setError] = useState<string | null>(initialError ?? null);
  const busy = action !== null;
  const sendDeadlines = useRef(new Map<string, number>()), verifyDeadlines = useRef(new Map<string, number>()), focusAfterSend = useRef(false);
  const submitting = useRef(false), humanCheck = useRef<TurnstileHandle>(null), emailInput = useRef<HTMLInputElement>(null), codeInput = useRef<HTMLInputElement>(null);
  const [siteKey, setSiteKey] = useState(''), [checkingHuman, setCheckingHuman] = useState(false), [configLoading, setConfigLoading] = useState(true);
  const [configAttempt, setConfigAttempt] = useState(0);
  const normalizedEmail = email.trim().toLowerCase(), emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const hasChallenge = challengeId !== null && sentEmail === normalizedEmail;
  useEffect(() => {
    let active = true; setConfigLoading(true);
    void api.get<{ turnstile: { siteKey: string } }>('/auth/email/config', { timeoutMs: 10000, timeoutMessage: '安全验证加载超时，请重试' }).then(result => { if (active) { setSiteKey(result.turnstile.siteKey); } }).catch(e => { if (active) setError(errorText(e)); }).finally(() => { if (active) setConfigLoading(false); });
    return () => { active = false; };
  }, [configAttempt]);
  const handleError = (e: unknown, verification = false) => {
    setError(errorText(e));
    if (e instanceof ApiError && e.retryAfter) {
      const deadline = Date.now() + e.retryAfter * 1000;
      (verification ? verifyDeadlines : sendDeadlines).current.set(normalizedEmail, deadline);
      (verification ? setVerifyRetryAt : setRetryAt)(deadline);
    }
  };
  useEffect(() => { if (location.pathname === '/register') navigate('/login', { replace: true }); }, [location.pathname, navigate]);
  useEffect(() => {
    const tick = () => { setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))); setVerifySeconds(Math.max(0, Math.ceil((verifyRetryAt - Date.now()) / 1000))); };
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [retryAt, verifyRetryAt]);
  // Only a successful send moves focus; countdowns and failed retries do not.
  useEffect(() => { if (focusAfterSend.current && hasChallenge && !busy) { focusAfterSend.current = false; codeInput.current?.focus(); } }, [challengeId, hasChallenge, busy]);
  const send = async () => {
    if (submitting.current || Date.now() < retryAt || !siteKey || !emailValid || !emailInput.current?.reportValidity()) return;
    submitting.current = true; setAction('send'); setError(null);
    try {
      setCheckingHuman(true);
      const humanToken = await humanCheck.current?.verify();
      setCheckingHuman(false);
      if (!humanToken) throw new Error('安全验证未完成，请重试');
      const result = await api.post<{ challengeId: string; retryAfter: number }>('/auth/email/request', { email: normalizedEmail, humanToken }, { timeoutMs: 20000, timeoutMessage: '验证码发送响应超时，请稍后重试' });
      const deadline = Date.now() + result.retryAfter * 1000;
      sendDeadlines.current.set(normalizedEmail, deadline); focusAfterSend.current = true;
      setChallengeId(result.challengeId); setSentEmail(normalizedEmail); setCode(''); setRetryAt(deadline);
    } catch (e) { handleError(e); } finally { submitting.current = false; setCheckingHuman(false); setAction(null); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!hasChallenge) { setError('请先获取邮箱验证码'); return; }
    if (submitting.current || Date.now() < verifyRetryAt || !/^\d{6}$/.test(code)) return;
    submitting.current = true; setAction('verify'); setError(null); let authenticated = false;
    try {
      await api.post(bindExisting ? '/auth/email/bind' : '/auth/email/verify', { email: normalizedEmail, code, challengeId }, { timeoutMs: 20000, timeoutMessage: '登录响应超时，请刷新页面确认登录状态' });
      authenticated = true; setCode(''); await onLogin();
    } catch (e) { if (authenticated) setError('已完成验证，请刷新页面继续'); else handleError(e, true); } finally { submitting.current = false; setAction(null); }
  };
  return <main className="login-layout"><form className="login-card auth-card" onSubmit={submit}>
    <a className="brand auth-brand" href="/" aria-label="知行方舟首页"><BrandLogo size={36}/><span>知行方舟</span></a>
    <h1>{bindExisting ? '设置登录邮箱' : title}</h1>
    {bindExisting && <p className="auth-intro">验证邮箱后，用此邮箱登录。</p>}
    <Field label={bindExisting ? '登录邮箱' : '邮箱'}><input ref={emailInput} type="email" required disabled={busy} autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} onChange={e => {
      const next = e.target.value.trim().toLowerCase(); setEmail(e.target.value); setError(null);
      if (next !== normalizedEmail) { setChallengeId(null); setSentEmail(''); setCode(''); focusAfterSend.current = false; setRetryAt(sendDeadlines.current.get(next) ?? 0); setVerifyRetryAt(verifyDeadlines.current.get(next) ?? 0); }
    }} placeholder="name@company.com"/></Field>
    <div className="field"><label className="auth-code-label" htmlFor={codeId}>6位验证码<span className="required-mark" aria-hidden="true"> *</span></label><div className="auth-code-row"><input id={codeId} ref={codeInput} className="auth-otp-input" required disabled={busy} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} aria-describedby="auth-code-status auth-error" onChange={e => { setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)); setError(null); }} onPaste={e => { const digits = e.clipboardData.getData('text').replace(/[\s-]/g, ''); if (/^\d{6}$/.test(digits)) { e.preventDefault(); setCode(digits); setError(null); } }}/>
      <button type="button" className="auth-text-button auth-send" disabled={busy || configLoading || !siteKey || !emailValid || seconds > 0} onClick={() => void send()}>{action === 'send' ? checkingHuman ? '安全验证中…' : '发送中…' : seconds > 0 ? `${seconds}秒后重发` : hasChallenge ? '重新获取' : '获取验证码'}</button>
    </div></div>
    <p id="auth-code-status" className="auth-code-status" role="status">{hasChallenge ? '验证码已发送，请查收邮件。' : ''}</p>
    <div id="auth-error"><Notice text={error}/></div>
    {siteKey && <Turnstile siteKey={siteKey} ref={humanCheck} onVerified={() => setError(null)}/>}
    {!configLoading && !siteKey && <button type="button" className="auth-text-button auth-config-retry" onClick={() => { setError(null); setConfigAttempt(x => x + 1); }}>重新加载安全验证</button>}
    <button type="submit" className="primary wide auth-submit" disabled={busy || !hasChallenge || verifySeconds > 0 || code.length !== 6}>
      {action === 'verify' && <span className="auth-spinner" aria-hidden="true"/>}
      {action === 'verify' ? '登录中…' : verifySeconds > 0 ? `${verifySeconds}秒后重试` : bindExisting ? '确认邮箱' : '登录'}
    </button>
  </form></main>;
}

export function EnterpriseOnboarding({ workspaceUrl, onCreated, onLogout, returnTo }: { workspaceUrl: string; returnTo?:string; onCreated: () => Promise<void>; onLogout: () => Promise<void> }) {
  const [name, setName] = useState(''); const [invitation, setInvitation] = useState(''); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => { e.preventDefault(); if (busy) return; setBusy(true); setError(null); try { const result = await api.post<{tenant:{slug:string}}>('/onboarding/enterprise', { name }); await onCreated(); const next=returnTo&&/^\/connect\/(?:authorize|connections|actions\/[a-f0-9-]{36})(?:\?|$)/i.test(returnTo)?returnTo:'/t/'+encodeURIComponent(result.tenant.slug);window.location.assign(workspaceUrl.replace(/\/$/, '') + next); } catch (e) { setError(errorText(e)); setBusy(false); } };
  const join = (e: FormEvent) => { e.preventDefault(); try { const url = new URL(invitation); const token = new URLSearchParams(url.hash.slice(1)).get('token'); if (!token || token.length < 32 || token.length > 200 || !url.pathname.endsWith('/join')) throw new Error('请粘贴管理员提供的完整邀请链接'); window.location.assign(workspaceUrl.replace(/\/$/, '') + '/join#token=' + encodeURIComponent(token)); } catch { setError('请粘贴管理员提供的完整邀请链接'); } };
  return <main className="picker onboarding"><div className="panel"><h1>开始使用知行方舟</h1><Notice text={error}/><form onSubmit={create}><h2>创建企业</h2><Field label="企业名称"><input required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></Field><button className="primary" disabled={busy}>{busy ? '创建中…' : '创建并进入企业'}</button></form><form onSubmit={join}><h2>加入已有企业</h2><Field label="邀请链接"><input type="url" required maxLength={1000} value={invitation} onChange={e => setInvitation(e.target.value)} placeholder="粘贴管理员提供的邀请链接"/></Field><button disabled={busy}>继续接受邀请</button></form><button className="text-button" disabled={busy} onClick={() => void onLogout()}>退出登录</button></div></main>;
}
