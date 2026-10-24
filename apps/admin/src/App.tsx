import { AiConversation } from '@suite/frontend/AiConversation';
import { Sparkles } from '@suite/frontend/components';
import { CommercialPage } from '@suite/frontend/CommercialPage';
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ServiceStatusProvider } from '@suite/frontend/services';
import { SessionApp, AccessDenied } from '@suite/frontend/session';
import { AdminPage } from '@suite/frontend/AdminPage';
import { KnowledgePage } from '@suite/frontend/KnowledgePage';
import { ChannelPage } from '@suite/frontend/ChannelPage';
import type { Me } from '@suite/frontend/types';
import { PageTitle, Empty, ShellBrand, ShellToolbar, NavIcon, UserMenu, UserMenuIcon, NotificationCenter, useNavigationFocus } from '@suite/frontend/components';
export function App() { return <SessionApp title="企业管理登录">{(me, logout) => <Routes><Route path="/t/:tenantKey/*" element={<TenantAdmin me={me} logout={logout} />} /><Route path="*" element={<main className="picker"><PageTitle title="选择管理的企业" action={<button onClick={() => void logout()}>退出登录</button>} /><div className="cards">{me.tenants.filter(m => m.role === 'admin').map(m => <Link className="tenant-card" key={m.id} to={`/t/${m.tenant.slug}`}><strong>{m.tenant.name}</strong></Link>)}</div>{!me.tenants.some(m => m.role === 'admin') && <AccessDenied onLogout={logout} />}</main>} /></Routes>}</SessionApp>; }
function TenantAdmin({ me, logout }: { me: Me; logout: () => Promise<void> }) {
  const location = useLocation(); const { tenantKey = '' } = useParams(); const member = me.tenants.find(m => m.tenant.slug === tenantKey && m.role === 'admin'); const [menu, setMenu] = useState(false); const [aiOpen,setAiOpen]=useState(false); const aiLinked=new URLSearchParams(location.search).has('conversation');
  useNavigationFocus(menu, setMenu);
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  if (!member) return <AccessDenied onLogout={logout} />;
  const workspace = import.meta.env.VITE_WORKSPACE_URL ?? 'http://127.0.0.1:4601';
  return <div className="app-shell"><ShellToolbar menuOpen={menu} label="企业管理" onMenu={() => setMenu(true)} aiAction={<button type="button" className="ask-ai-trigger" aria-label="询问 AI" aria-expanded={aiOpen||aiLinked} onClick={()=>{setMenu(false);setAiOpen(true);}}><Sparkles size={20} aria-hidden="true"/><span>询问AI</span></button>}/>{menu && <button className="scrim" aria-label="关闭导航" onClick={() => setMenu(false)} />}<a className="skip-link" href="#main-content">跳到页面内容</a><aside id="shell-navigation" className={`sidebar ${menu ? 'open' : ''}`}><ShellBrand subtitle="企业管理"/><div className="tenant-label">{member.tenant.name}</div><nav aria-label="企业管理导航" onClick={() => setMenu(false)}><NavLink end to={`/t/${tenantKey}`}><NavIcon name="admin"/>组织与成员</NavLink><NavLink to={`/t/${tenantKey}/knowledge`}><NavIcon name="knowledge"/>知识库管理</NavLink><NavLink to={`/t/${tenantKey}/commercial`}><NavIcon name="admin"/>订阅与支持</NavLink><NavLink to={`/t/${tenantKey}/channels`}><NavIcon name="channels"/>消息与通知</NavLink></nav><div className="sidebar-footer"><UserMenu name={me.user.name} email={me.user.account ?? me.user.email} subtitle="企业管理员" closeKey={`${location.pathname}:${menu}`} onLogout={logout} trailingAction={<NotificationCenter memberships={[member]} workspaceUrl={workspace} closeKey={location.pathname} onOpen={() => setMenu(false)} onNavigate={() => setMenu(false)}/> }>
    <a href={`${workspace}/t/${tenantKey}/account`}><UserMenuIcon name="account" />账号设置</a>
    <a href={`${workspace}/t/${tenantKey}`}><UserMenuIcon name="workspace" />返回工作台</a>
    {me.tenants.filter(m => m.role === 'admin').length > 1 && <Link to="/"><UserMenuIcon name="company" />切换企业</Link>}
    {me.platformRole === 'operator' && <a href={`${import.meta.env.VITE_PLATFORM_ADMIN_URL ?? 'http://127.0.0.1:4604'}/`}><UserMenuIcon name="operator" />平台运营</a>}
  </UserMenu></div></aside><main id="main-content" tabIndex={-1} className="content"><ServiceStatusProvider key={tenantKey} tenantKey={tenantKey} statusPath={`/tenants/${encodeURIComponent(tenantKey)}/management-ai/status`}><Routes><Route index element={<AdminPage key={tenantKey} tenantKey={tenantKey} onAppsChanged={() => {}} />} /><Route path="knowledge" element={<KnowledgePage key={tenantKey} tenantKey={tenantKey} isAdmin />} /><Route path="commercial" element={<CommercialPage tenantKey={tenantKey}/>}/><Route path="channels" element={<ChannelPage key={tenantKey} tenantKey={tenantKey} isAdmin />} /><Route path="admin" element={<Navigate to={`/t/${tenantKey}`} replace />} /><Route path="*" element={<Empty text="页面不存在" />} /></Routes><AiConversation key={tenantKey} tenantKey={tenantKey} scope="tenant_admin" apiBase={`/tenants/${encodeURIComponent(tenantKey)}/management-ai`} open={aiOpen||aiLinked} onClose={()=>setAiOpen(false)}/></ServiceStatusProvider></main></div>;
}
