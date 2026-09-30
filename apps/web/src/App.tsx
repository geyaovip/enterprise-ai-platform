import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, errorText, tenantApi } from './api';
import { Empty, Field, Loading, Notice, PageTitle } from './components';
import type { Me, TenantApp, TenantMembership } from './types';
import { DashboardPage, CustomerPage, OpportunityPage, ProductPage, SupplierPage } from './pages/MasterPages';
import { PurchasePage, PurchaseDetailPage, ContractPage, ContractDetailPage } from './pages/Orders';
import { InventoryPage, FinancePage } from './pages/Operations';
import { AiPage } from './pages/AiPage';
import { AdminPage } from './pages/AdminPage';
import { ChannelPage } from './pages/ChannelPage';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setMe(await api.get<Me>('/me')); setError(null); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setMe(null); else setError(errorText(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const logout = async () => { try { await api.post('/auth/logout', {}); } finally { setMe(null); navigate('/login'); } };
  if (loading) return <div className="boot"><Loading /></div>;
  if (!me) return <LoginPage onLogin={refresh} error={error} />;
  return <Routes>
    <Route path="/login" element={<Navigate to="/tenants" replace />} />
    <Route path="/tenants" element={<TenantPicker memberships={me.tenants} onLogout={logout} />} />
    <Route path="/t/:tenantKey/*" element={<TenantShell me={me} onLogout={logout} />} />
    <Route path="*" element={<Navigate to="/tenants" replace />} />
  </Routes>;
}

function LoginPage({ onLogin, error }: { onLogin: () => Promise<void>; error?: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(error ?? null);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setMessage(null); try { await api.post('/auth/login', { email, password }); await onLogin(); } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); } };
  return <main className="login-layout"><form className="login-card" onSubmit={submit}><div className="brand">知行方舟 · 企业智能业务平台</div><h1>登录工作区</h1><p>使用企业管理员开通的账号访问业务数据。</p><Notice text={message} /><Field label="邮箱"><input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></Field><Field label="密码"><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field><button className="primary wide" disabled={busy}>{busy ? '登录中…' : '登录'}</button></form></main>;
}

function TenantPicker({ memberships, onLogout }: { memberships: TenantMembership[]; onLogout: () => void }) {
  return <main className="picker"><PageTitle title="选择企业" subtitle="只显示你当前有权访问的企业。" action={<button onClick={onLogout}>退出登录</button>} />{memberships.length ? <div className="cards">{memberships.map(item => <Link className="tenant-card" key={item.id} to={`/t/${item.tenant.slug}/erp`}><strong>{item.tenant.name}</strong><span>{item.role}</span></Link>)}</div> : <Empty text="当前账号没有可访问的企业，请联系管理员。" />}</main>;
}

const erpNav = [
  { path: 'erp', label: '经营概览', roles: ['admin', 'sales', 'purchasing', 'warehouse', 'finance'] },
  { path: 'erp/customers', label: '客户', roles: ['admin', 'sales', 'finance'] },
  { path: 'erp/opportunities', label: '商机', roles: ['admin', 'sales', 'finance'] },
  { path: 'erp/contracts', label: '销售合同', roles: ['admin', 'sales', 'warehouse', 'finance'] },
  { path: 'erp/products', label: '商品', roles: ['admin', 'sales', 'purchasing', 'warehouse', 'finance'] },
  { path: 'erp/suppliers', label: '供应商', roles: ['admin', 'purchasing', 'warehouse', 'finance'] },
  { path: 'erp/purchases', label: '采购', roles: ['admin', 'purchasing', 'warehouse', 'finance'] },
  { path: 'erp/inventory', label: '库存与预警', roles: ['admin', 'purchasing', 'warehouse'] },
  { path: 'erp/finance', label: '应收应付', roles: ['admin', 'finance'] },
  { path: 'ai', label: 'AI 助手', roles: ['admin', 'sales', 'purchasing', 'warehouse', 'finance'] },
] as const;

function TenantShell({ me, onLogout }: { me: Me; onLogout: () => Promise<void> }) {
  const { tenantKey = '' } = useParams();
  const location = useLocation();
  const [apps, setApps] = useState<TenantApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const membership = me.tenants.find(x => x.tenant.slug === tenantKey);
  useEffect(() => { setApps(null); if (!membership) return; api.get<TenantApp[]>(tenantApi(tenantKey, '/apps')).then(setApps).catch(e => setError(errorText(e))); }, [tenantKey, membership?.id]);
  useEffect(() => { setMenu(false); }, [location.pathname]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  if (!membership) return <main className="picker"><Notice text="无权访问此企业" /><Link to="/tenants">返回企业选择</Link></main>;
  const erpEnabled = apps?.some(x => x.appId === 'erp' && x.enabled) ?? false;
  const prefix = `/t/${tenantKey}`;
  return <div className="app-shell">
    <button className="mobile-menu" aria-label="打开导航" onClick={() => setMenu(true)}>☰ 菜单</button>
    {menu && <button className="scrim" aria-label="关闭导航" onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? 'open' : ''}`}><div className="brand">知行方舟</div><div className="tenant-label">{membership.tenant.name}<small>当前应用：{erpEnabled ? 'ERP' : '未启用'}</small></div><nav aria-label="主导航">{erpEnabled && erpNav.filter(item => (item.roles as readonly string[]).includes(membership.role)).map(({ path, label }) => <Link key={path} className={location.pathname === `${prefix}/${path}` ? 'active' : ''} to={`${prefix}/${path}`}>{label}</Link>)}<Link className={location.pathname.includes('/channels') ? 'active' : ''} to={`${prefix}/channels`}>工作通道</Link>{membership.role === 'admin' && <Link className={location.pathname.includes('/admin') ? 'active' : ''} to={`${prefix}/admin`}>企业管理</Link>}</nav><div className="sidebar-footer"><Link to="/tenants">切换企业</Link><Link to={`${prefix}/account`}>{me.user.name} · 账号</Link><button onClick={onLogout}>退出</button></div></aside>
    <main className="content"><Notice text={error} />{apps === null ? <Loading /> : <Routes>
      <Route index element={<Navigate to={erpEnabled ? 'erp' : 'admin'} replace />} />
      <Route path="erp" element={erpEnabled ? <DashboardPage tenantKey={tenantKey} /> : <Empty text="ERP 尚未启用，请联系企业管理员。" />} />
      <Route path="erp/customers" element={erpEnabled ? <CustomerPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="ERP 未启用" />} />
      <Route path="erp/opportunities" element={erpEnabled ? <OpportunityPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="ERP 未启用" />} />
      <Route path="erp/products" element={erpEnabled ? <ProductPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="ERP 未启用" />} />
      <Route path="erp/suppliers" element={erpEnabled ? <SupplierPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="ERP 未启用" />} />
      <Route path="erp/purchases" element={erpEnabled ? <PurchasePage tenantKey={tenantKey} role={membership.role} /> : <Empty text="ERP 未启用" />} />
      <Route path="erp/purchases/:id" element={erpEnabled ? <PurchaseDetailPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="ERP 未启用" />} />
      <Route path="erp/contracts" element={erpEnabled ? <ContractPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="ERP 未启用" />} />
      <Route path="erp/contracts/:id" element={erpEnabled ? <ContractDetailPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="ERP 未启用" />} />
      <Route path="erp/inventory" element={erpEnabled ? <InventoryPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="ERP 未启用" />} />
      <Route path="erp/finance" element={erpEnabled ? <FinancePage tenantKey={tenantKey} role={membership.role} /> : <Empty text="ERP 未启用" />} />
      <Route path="ai" element={erpEnabled ? <AiPage tenantKey={tenantKey} /> : <Empty text="ERP 未启用" />} />
      <Route path="admin" element={membership.role === 'admin' ? <AdminPage tenantKey={tenantKey} onAppsChanged={() => api.get<TenantApp[]>(tenantApi(tenantKey, '/apps')).then(setApps)} /> : <Empty text="无权访问企业管理" />} />
      <Route path="channels" element={<ChannelPage tenantKey={tenantKey} isAdmin={membership.role === 'admin'} />} />
      <Route path="account" element={<AccountPage user={me.user} onChanged={onLogout} />} />
      <Route path="*" element={<div><PageTitle title="页面不存在" /><Link to={`${prefix}/erp`}>返回概览</Link></div>} />
    </Routes>}</main>
  </div>;
}

function AccountPage({ user, onChanged }: { user: Me['user']; onChanged: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMessage(null);
    try { await api.post('/auth/change-password', { currentPassword, nextPassword }); await onChanged(); }
    catch (error) { setMessage(errorText(error)); setBusy(false); }
  };
  return <><PageTitle title="账号安全" subtitle={`${user.name} · ${user.email}`} /><form className="panel form-panel" onSubmit={submit}><h2>修改密码</h2><p>修改成功后，当前账号的所有会话都会失效，需要重新登录。</p><Notice text={message} /><div className="form-grid"><Field label="当前密码"><input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></Field><Field label="新密码（至少 12 位）"><input type="password" autoComplete="new-password" minLength={12} required value={nextPassword} onChange={e => setNextPassword(e.target.value)} /></Field></div><button className="primary" disabled={busy}>修改密码</button></form></>;
}
