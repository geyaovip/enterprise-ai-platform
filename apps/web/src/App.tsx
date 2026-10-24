import {MesPage,mesNavigation} from './mes/MesPage';
import {CrmPage,crmNavigation} from './crm/CrmPage';
import {registerBusinessApplication} from './applications';
import { AuthScreen, EnterpriseOnboarding } from '@suite/frontend/auth-screen';
import { safeReturn } from './business-context';
import { Sparkles } from '@suite/frontend/components';
import { BrandIdentity, ApplicationSwitcher, ErpApplicationIcon, CrmApplicationIcon, MesApplicationIcon, ApplicationIcon } from '@suite/frontend/components';
import { useApplicationNavigation } from './application-navigation';
import { businessApplicationEntries } from './applications';
import { TaskCenterPage } from './pages/TaskCenterPage';
import { ReplenishmentPage } from './pages/ReplenishmentPage';
import { OperatingEventsPage } from './pages/OperatingEventsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { JoinPage } from './pages/JoinPage';
import { QuotesPage } from './pages/QuotesPage';
import { ReturnsPage } from './pages/ReturnsPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { ReportsPage } from './pages/ReportsPage';
import { OpeningPage } from './pages/OpeningPage';
import { AdvancesPage } from './pages/AdvancesPage';
import { BusinessSettingsPage } from './pages/BusinessSettingsPage';
import { PrintDocumentPage } from './pages/PrintDocumentPage';
import { CollaborationPage } from './pages/CollaborationPage';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, errorText, tenantApi } from './api';
import { useApiData } from './hooks';
import { Empty, Field, Loading, Notice, PageTitle, PasswordInput, useNavigationFocus } from './components';
import type { Me, TenantApp, TenantMembership } from './types';
import { DashboardPage, CustomerPage, OpportunityPage, ProductPage, SupplierPage } from './pages/MasterPages';
import { PurchasePage, PurchaseDetailPage, ContractPage, ContractDetailPage } from './pages/Orders';
import { InventoryPage, FinancePage } from './pages/Operations';
import { AiPage } from './pages/AiPage';
import { ShellBrand, ShellToolbar, NavIcon, UserMenu, UserMenuIcon, NotificationCenter } from '@suite/frontend/components';
import { ServiceStatusProvider } from '@suite/frontend/services';
import { KnowledgePage } from '@suite/frontend/KnowledgePage';
import { ChannelPage } from './pages/ChannelPage';
import { WorkItemsPage } from './pages/WorkItemsPage';
import { InvoicePage } from './pages/InvoicePage';
import { ReceiptPage } from './pages/ReceiptPage';

registerBusinessApplication({appId:'mes',routePrefix:'/mes',description:'BOM、生产计划与工单执行',shortName:'MES',Page:MesPage});
registerBusinessApplication({appId:'crm',routePrefix:'/crm',description:'客户洞察、复购与运营',shortName:'CRM',Page:CrmPage});

export function App() { return <><BrandIdentity/><WorkspaceApp/></>; }
function WorkspaceApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location=useLocation();
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const profile=await api.get<Me>('/me');sessionStorage.setItem('suite:view-user',profile.user.id);setMe(profile); setError(null); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setMe(null); else setError(errorText(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = async () => { try { const profile=await api.get<Me>('/me');sessionStorage.setItem('suite:view-user',profile.user.id);setMe(profile); setError(null); } catch (e) { if (e instanceof ApiError && e.status === 401) setMe(null); else setError(errorText(e)); } };
    window.addEventListener('focus', focus); return () => { window.removeEventListener('focus', focus); };
  }, [refresh]);
  const logout = async () => { try { await api.post('/auth/logout', {}); } finally { for(const key of Object.keys(sessionStorage))if(key.startsWith('suite:view:'))sessionStorage.removeItem(key);sessionStorage.removeItem('suite:view-user');setMe(null); navigate('/login'); } };
  if (loading) return <div className="boot"><Loading /></div>;
  if(location.pathname==='/join')return <JoinPage/>;
  if (!me) return <AuthScreen title="登录工作台" onLogin={refresh} initialError={error} />;
  if (!me.tenants.length) return <EnterpriseOnboarding workspaceUrl={import.meta.env.BASE_URL.replace(/\/$/, '')} onCreated={refresh} onLogout={logout}/>;
  return <Routes>
    <Route path="/login" element={<Navigate to={me.tenants.length === 1 ? `/t/${me.tenants[0].tenant.slug}` : '/tenants'} replace />} />
    <Route path="/onboarding" element={<EnterpriseOnboarding workspaceUrl="" onCreated={refresh} onLogout={logout}/>}/>
    <Route path="/tenants" element={<TenantPicker memberships={me.tenants} onLogout={logout} />} />
    <Route path="/t/:tenantKey/*" element={<TenantScope me={me} onLogout={logout} />} />
    <Route path="*" element={<Navigate to={me.tenants.length === 1 ? `/t/${me.tenants[0].tenant.slug}` : '/tenants'} replace />} />
  </Routes>;
}

function ManagementAiRedirect({ tenantKey, operator=false }: {tenantKey:string;operator?:boolean}) {
  const location=useLocation();
  useEffect(()=>{const id=new URLSearchParams(location.search).get('conversation');const target=operator?(import.meta.env.VITE_PLATFORM_ADMIN_URL??'http://127.0.0.1:4604')+'/':(import.meta.env.VITE_TENANT_ADMIN_URL??'http://127.0.0.1:4603')+'/t/'+encodeURIComponent(tenantKey);window.location.replace(target+(id&&/^[0-9a-f-]{36}$/i.test(id)?'?conversation='+encodeURIComponent(id):''));},[tenantKey,operator,location.search]);
  return <Loading/>;
}

function TenantPicker({ memberships, onLogout }: { memberships: TenantMembership[]; onLogout: () => void }) {
  return <main className="picker"><PageTitle title="选择企业" action={<><Link className="button" to="/onboarding">创建或加入企业</Link><button onClick={onLogout}>退出登录</button></>} />{memberships.length ? <div className="cards">{memberships.map(item => <Link className="tenant-card" key={item.id} to={`/t/${item.tenant.slug}`}><strong>{item.tenant.name}</strong><span>{({ admin: '企业管理员', sales: '销售', purchasing: '采购', warehouse: '仓库', finance: '财务' } as Record<string, string>)[item.role] ?? '企业成员'}</span></Link>)}</div> : <Empty text="当前账号没有可访问的企业，请联系管理员。" />}</main>;
}

const erpNav = [
  {path:'tasks',label:'任务中心',roles:['admin','sales','purchasing','warehouse','finance']},
  {path:'erp/operating-events',label:'经营事件',roles:['admin','sales','purchasing','warehouse','finance']},
  {path:'erp/replenishment',label:'补货建议',roles:['admin','purchasing','warehouse']},
  {path:'erp/quotes',label:'销售报价',roles:['admin','sales','finance']},
  {path:'erp/returns',label:'退货与售后',roles:['admin','sales','purchasing','warehouse','finance']},
  {path:'erp/warehouses',label:'仓库与调拨',roles:['admin','warehouse','purchasing']},
  {path:'erp/reports',label:'经营报表与对账',roles:['admin','finance']},
  {path:'erp/advances',label:'预收预付',roles:['admin','finance']},
  {path:'erp/opening',label:'期初导入',roles:['admin']},
  {path:'erp/business-settings',label:'企业业务设置',roles:['admin']},
  { path: 'erp', label: '经营概览', roles: ['admin', 'sales', 'purchasing', 'warehouse', 'finance'] },
  { path: 'erp/collaboration', label: '任务与公告', roles: ['admin', 'sales', 'purchasing', 'warehouse', 'finance'] },
  {path:'erp/workflows',label:'业务流转',roles:['admin','sales','purchasing','warehouse','finance']},
  { path: 'erp/work-items', label: '我的待办', roles: ['admin', 'sales', 'purchasing', 'warehouse', 'finance'] },
  { path: 'erp/customers', label: '客户', roles: ['admin', 'sales', 'finance'] },
  { path: 'erp/opportunities', label: '商机', roles: ['admin', 'sales', 'finance'] },
  { path: 'erp/contracts', label: '销售合同', roles: ['admin', 'sales', 'warehouse', 'finance'] },
  { path: 'erp/products', label: '商品', roles: ['admin', 'sales', 'purchasing', 'warehouse', 'finance'] },
  { path: 'erp/suppliers', label: '供应商', roles: ['admin', 'purchasing', 'warehouse', 'finance'] },
  { path: 'erp/purchases', label: '采购订单', roles: ['admin', 'purchasing', 'warehouse', 'finance'] },
  { path: 'erp/inventory', label: '库存与预警', roles: ['admin', 'purchasing', 'warehouse'] },
  { path: 'erp/finance', label: '应收应付', roles: ['admin', 'finance'] },
  { path: 'erp/invoices', label: '开票申请', roles: ['admin', 'sales', 'finance'] },
  { path: 'erp/receipts', label: '收款认领', roles: ['admin', 'sales', 'finance'] },
  { path: 'ai', label: 'AI 助手', roles: ['admin', 'sales', 'purchasing', 'warehouse', 'finance'] },
] as const;

const erpNavGroups = [
  { label: '工作台', paths: ['erp', 'erp/work-items', 'tasks', 'erp/operating-events', 'erp/workflows', 'erp/collaboration'] },
  { label: '销售管理', paths: ['erp/customers', 'erp/opportunities', 'erp/quotes', 'erp/contracts', 'erp/returns'] },
  { label: '采购与库存', paths: ['erp/products', 'erp/suppliers', 'erp/purchases', 'erp/replenishment', 'erp/inventory', 'erp/warehouses'] },
  { label: '财务管理', paths: ['erp/finance', 'erp/receipts', 'erp/invoices', 'erp/advances', 'erp/reports', 'erp/opening'] },
] as const;

function TenantScope(props: { me: Me; onLogout: () => Promise<void> }) {
  const { tenantKey = '' } = useParams();
  return <TenantShell {...props} key={`${props.me.user.id}:${tenantKey}`} />;
}

function TenantShell({ me, onLogout }: { me: Me; onLogout: () => Promise<void> }) {
  const navigateInShell = useNavigate();
  const [aiOpen,setAiOpen] = useState(false);
  const { tenantKey = '' } = useParams();
  const location = useLocation();
  useEffect(()=>{setAiOpen(false);},[location.pathname]);
  const applicationCatalog=useApiData<Array<{appId:string;displayName:string;routePrefix:string;permissions:string[]}>>(tenantApi(tenantKey,'/applications'));
  useEffect(()=>{const refresh=()=>void applicationCatalog.reload();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[applicationCatalog.reload]);
  const [apps, setApps] = useState<TenantApp[] | null>(null);
  const [permissions,setPermissions]=useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<Array<{ capability: string; delivered: boolean; enabled: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  useNavigationFocus(menu, setMenu);
  const membership = me.tenants.find(x => x.tenant.slug === tenantKey);
  useEffect(() => {
    let alive = true;
    const refresh = async () => { if (!membership) return; try {
      const [a, c] = await Promise.all([api.get<TenantApp[]>(tenantApi(tenantKey, '/apps')), api.get<Array<{ capability: string; delivered: boolean; enabled: boolean }>>(tenantApi(tenantKey, '/capabilities'))]);
      if (alive) { setApps(a); setCapabilities(c); if(a.some(x=>x.appId==='erp'&&x.enabled&&x.granted)){const settings=await api.get<{permissions:string[]}>(tenantApi(tenantKey,'/erp/business-settings'));if(alive)setPermissions(settings.permissions);}else setPermissions([]);setError(null); }
    } catch (e) { if (alive) { setApps([]); setCapabilities([]); setError(errorText(e)); } } };
    void refresh(); window.addEventListener('focus', refresh);
    return () => { alive = false; window.removeEventListener('focus', refresh); };
  }, [tenantKey, membership?.id]);
  useEffect(() => { setMenu(false); }, [location.pathname]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setMenu(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    const revealCurrent = () => navigation.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(navigation);
    return () => observer.disconnect();
  }, [location.pathname, apps, permissions, menu]);
  const crmMeta=useApiData<any>(apps?.some(x=>x.appId==='crm'&&x.enabled&&x.granted)&&applicationCatalog.data?.some(a=>a.appId==='crm'&&a.permissions.length)?tenantApi(tenantKey,'/apps/crm/metadata'):null);
  const mesMeta=useApiData<any>(apps?.some(x=>x.appId==='mes'&&x.enabled&&x.granted)&&applicationCatalog.data?.some(a=>a.appId==='mes'&&a.permissions.length)?tenantApi(tenantKey,'/apps/mes/metadata'):null);
  const enabledApplications = [
    ...(apps?.some(x=>x.appId==='erp'&&x.enabled&&x.granted)&&applicationCatalog.data?.some(a=>a.appId==='erp'&&a.permissions.length)?[{id:'erp',name:'进销存 ERP',shortName:'ERP',description:'销售、采购、库存与财务',routePrefix:'/erp',icon:<ErpApplicationIcon/>,paths:erpNav.filter(item=>(item.roles as readonly string[]).includes(membership?.role??'')||(item.path==='erp/contracts'&&permissions.includes('erp.sales.read'))||(item.path==='erp/purchases'&&permissions.includes('erp.purchase.read'))).map(item=>'/'+item.path).filter(path=>!path.endsWith('/ai'))}]:[]),
    ...businessApplicationEntries().filter(entry=>applicationCatalog.data?.some(a=>a.appId===entry.appId&&a.routePrefix===entry.routePrefix&&a.permissions.length)&&apps?.some(a=>a.appId===entry.appId&&a.enabled&&a.granted)).map(entry=>({id:entry.appId,name:entry.appId==='crm'?'电商 CRM':applicationCatalog.data!.find(a=>a.appId===entry.appId)!.displayName,shortName:entry.shortName??entry.appId.toUpperCase(),description:entry.description??'企业业务应用',routePrefix:entry.routePrefix,icon:entry.appId==='crm'?<CrmApplicationIcon/>:entry.appId==='mes'?<MesApplicationIcon/>:<ApplicationIcon/>,paths:entry.appId==='crm'?crmNavigation.filter(([, ,p])=>crmMeta.data?.permissions.includes(p)).map(([path])=>entry.routePrefix+(path?'/'+path:'')):entry.appId==='mes'?mesNavigation.filter(([, ,p])=>mesMeta.data?.permissions.includes(p)).map(([path])=>entry.routePrefix+(path?'/'+path:'')):[entry.routePrefix]})),
  ];
  const applicationNavigation = useApplicationNavigation(me.user.id,tenantKey,enabledApplications,apps!==null&&!!applicationCatalog.data);
  if (!membership) return <main className="picker"><Notice text="无权访问此企业" /><Link to="/tenants">返回企业选择</Link></main>;
  const crmEnabled=apps?.some(x=>x.appId==='crm'&&x.enabled&&x.granted)??false;
  const crmActive=applicationNavigation.currentId==='crm';
  const mesActive=applicationNavigation.currentId==='mes';
  const businessScope=mesActive?'mes':crmActive?'crm':'erp';
  const appAiAllowed=mesActive?mesMeta.data?.permissions.includes('mes.ai.use'):crmActive?crmMeta.data?.permissions.includes('crm.ai.use'):true;
  const mesEnabled=apps?.some(x=>x.appId==='mes'&&x.enabled&&x.granted)??false;
  const erpEnabled = apps?.some(x => x.appId === 'erp' && x.enabled && x.granted) ?? false;
  const knowledgeEnabled = capabilities.some(c => c.capability === 'knowledge' && c.delivered && c.enabled);
  const prefix = `/t/${tenantKey}`;
  const active = (path: string) => path === 'erp' ? location.pathname === `${prefix}/erp` : location.pathname === `${prefix}/${path}` || location.pathname.startsWith(`${prefix}/${path}/`);
  const aiRoute=/\/(?:erp\/|crm\/|mes\/)?ai$/.test(location.pathname);
  return <div className="app-shell">
    <ShellToolbar menuOpen={menu} label="业务工作台" onMenu={() => setMenu(true)} aiAction={<button type="button" className="ask-ai-trigger" aria-label="询问 AI" disabled={!appAiAllowed} title={!appAiAllowed?(mesActive?mesMeta.data?.aiAvailability?.message:crmMeta.data?.aiAvailability?.message)??'当前应用未开放AI助手':undefined} aria-expanded={aiOpen || aiRoute} onClick={() => {setMenu(false);setAiOpen(true);}}><Sparkles size={20} aria-hidden="true"/><span>询问AI</span></button>} />
    {menu && <button className="scrim" aria-label="关闭导航" onClick={() => setMenu(false)} />}
    <a className="skip-link" href="#main-content">跳到页面内容</a>
    <aside id="shell-navigation" className={`sidebar ${menu ? 'open' : ''}`}>
      <ShellBrand subtitle="企业应用平台"/>
      <ApplicationSwitcher {...applicationNavigation}/>
      <div className="tenant-label workspace-tenant">{membership.tenant.name}</div>
      <nav ref={navigationRef} aria-label="主导航">
        {crmActive&&<section className="nav-group" aria-label="CRM导航"><h2>客户经营</h2>{crmNavigation.filter(([, ,p])=>crmMeta.data?.permissions.includes(p)).map(([path,label])=>{const current=path?active('crm/'+path):location.pathname===prefix+'/crm';return <Link key={path} to={prefix+'/crm'+(path?'/'+path:'')} className={current?'active':''} aria-current={current?'page':undefined}><NavIcon name={path==='customers'?'erp/customers':path==='tasks'?'tasks':path==='settings'?'admin':'erp'}/>{label}</Link>;})}</section>}

        {mesActive&&<section className="nav-group" aria-label="MES导航"><h2>制造执行</h2>{mesNavigation.filter(([, ,p])=>mesMeta.data?.permissions.includes(p)).map(([path,label])=>{const current=path?active('mes/'+path):location.pathname===prefix+'/mes';return <Link key={path} to={prefix+'/mes'+(path?'/'+path:'')} className={current?'active':''} aria-current={current?'page':undefined}><NavIcon name={path==='settings'?'admin':path==='orders'?'tasks':'erp'}/>{label}</Link>;})}</section>}
        {erpEnabled && !crmActive && !mesActive && erpNavGroups.map(group => {
          const items = group.paths.map(path => erpNav.find(item => item.path === path)!).filter(item =>
            (item.roles as readonly string[]).includes(membership.role)
            || (item.path === 'erp/contracts' && permissions.includes('erp.sales.read'))
            || (item.path === 'erp/purchases' && permissions.includes('erp.purchase.read')));
          return items.length > 0 && <section className="nav-group" key={group.label} aria-label={group.label}>
            <h2>{group.label}</h2>
            {items.map(({ path, label }) => <Link key={path} aria-current={active(path) ? 'page' : undefined} className={active(path) ? 'active' : ''} to={`${prefix}/${path}`}><NavIcon name={path}/>{label}</Link>)}
          </section>;
        })}
        <section className="nav-group" aria-label="企业服务"><h2>企业服务</h2>
          {knowledgeEnabled && <Link aria-current={active('knowledge') ? 'page' : undefined} className={active('knowledge') ? 'active' : ''} to={`${prefix}/knowledge`}><NavIcon name="knowledge"/>企业知识库</Link>}
          <Link aria-current={active('channels') ? 'page' : undefined} className={active('channels') ? 'active' : ''} to={`${prefix}/channels`}><NavIcon name="channels"/>消息与通知</Link>
          {erpEnabled && !crmActive && !mesActive && membership.role === 'admin' && <Link aria-current={active('erp/business-settings') ? 'page' : undefined} className={active('erp/business-settings') ? 'active' : ''} to={`${prefix}/erp/business-settings`}><NavIcon name="erp/business-settings"/>企业业务设置</Link>}
          {membership.role === 'admin' && <a href={`${import.meta.env.VITE_TENANT_ADMIN_URL ?? 'http://127.0.0.1:4603'}/t/${tenantKey}`}><NavIcon name="tenants"/>企业管理</a>}
        </section>
      </nav>
      <div className="sidebar-footer"><UserMenu name={me.user.name} email={me.user.account ?? me.user.email} subtitle={({ admin: '企业管理员', sales: '销售', purchasing: '采购', warehouse: '仓库', finance: '财务' } as Record<string, string>)[membership.role] ?? '企业成员'} closeKey={`${location.pathname}:${menu}`} onLogout={onLogout} trailingAction={<NotificationCenter memberships={[membership]} closeKey={location.pathname} onOpen={() => setMenu(false)} onNavigate={() => setMenu(false)}/> }>
        <Link to={`${prefix}/account`} aria-current={active('account') ? 'page' : undefined}><UserMenuIcon name="account" />账号设置</Link>
        {me.tenants.length > 1 && <Link to="/tenants"><UserMenuIcon name="company" />切换企业</Link>}<Link to="/onboarding"><UserMenuIcon name="company" />创建或加入企业</Link>
        {membership.role === 'admin' && <a href={`${import.meta.env.VITE_TENANT_ADMIN_URL ?? 'http://127.0.0.1:4603'}/t/${tenantKey}`}><UserMenuIcon name="company" />企业管理</a>}
        {me.platformRole === 'operator' && <a href={`${import.meta.env.VITE_PLATFORM_ADMIN_URL ?? 'http://127.0.0.1:4604'}/`}><UserMenuIcon name="operator" />平台运营</a>}
      </UserMenu></div>
    </aside>
    <main id="main-content" tabIndex={-1} className="content"><ServiceStatusProvider key={tenantKey+':'+businessScope} tenantKey={tenantKey} statusPath={businessScope!=='erp'?tenantApi(tenantKey,'/apps/'+businessScope+'/ai/status'):undefined}><Notice text={error} />{apps === null ? <Loading /> : <Routes>
      <Route index element={<Navigate to={erpEnabled ? 'erp' : crmEnabled ? 'crm' : mesEnabled ? 'mes' : knowledgeEnabled ? 'knowledge' : 'account'} replace />} />
      <Route path="erp" element={erpEnabled ? <DashboardPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/quotes" element={erpEnabled ? <QuotesPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用" />} />
      <Route path="erp/returns" element={erpEnabled ? <ReturnsPage tenantKey={tenantKey} role={membership.role} membershipId={membership.id} /> : <Empty text="进销存管理尚未启用" />} />
      <Route path="erp/warehouses" element={erpEnabled ? <WarehousesPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用" />} />
      <Route path="erp/reports" element={erpEnabled ? <ReportsPage tenantKey={tenantKey} /> : <Empty text="进销存管理尚未启用" />} />
      <Route path="erp/opening" element={erpEnabled ? <OpeningPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用" />} />
      <Route path="erp/advances" element={erpEnabled ? <AdvancesPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用" />} />
      <Route path="erp/business-settings" element={erpEnabled ? <BusinessSettingsPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用" />} />
      <Route path="erp/documents/:id" element={erpEnabled ? <PrintDocumentPage tenantKey={tenantKey} type="stock" /> : <Empty text="进销存管理尚未启用" />} />
      <Route path="erp/return-documents/:id" element={erpEnabled ? <PrintDocumentPage tenantKey={tenantKey} type="return" /> : <Empty text="进销存管理尚未启用" />} />
      <Route path="erp/quote-documents/:id" element={erpEnabled ? <PrintDocumentPage tenantKey={tenantKey} type="quote" /> : <Empty text="进销存管理尚未启用" />} />
      {businessApplicationEntries().filter(entry=>applicationCatalog.data?.some(a=>a.appId===entry.appId&&a.routePrefix===entry.routePrefix)).map(({appId,routePrefix,Page})=><Route key={appId} path={`${routePrefix.slice(1)}/*`} element={<Page tenantKey={tenantKey} permissions={permissions}/>}/>)}
      <Route path="tasks" element={<TaskCenterPage tenantKey={tenantKey}/>}/>
      <Route path="erp/replenishment" element={erpEnabled?<ReplenishmentPage tenantKey={tenantKey} canCreate={permissions.includes('erp.purchase.write')}/>:<Empty text="应用尚未启用"/>}/>
      <Route path="erp/operating-events" element={erpEnabled?<OperatingEventsPage tenantKey={tenantKey} isAdmin={membership.role==='admin'}/>:<Empty text="应用尚未启用"/>}/>
      <Route path="erp/collaboration" element={erpEnabled ? <CollaborationPage tenantKey={tenantKey} membershipId={membership.id} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/workflows" element={erpEnabled?<WorkflowsPage tenantKey={tenantKey} role={membership.role}/>:<Empty text="进销存管理尚未启用"/>}/>
      <Route path="erp/work-items" element={erpEnabled ? <WorkItemsPage tenantKey={tenantKey} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/customers" element={erpEnabled ? <CustomerPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/opportunities" element={erpEnabled ? <OpportunityPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/products" element={erpEnabled ? <ProductPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/suppliers" element={erpEnabled ? <SupplierPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/purchases" element={erpEnabled ? <PurchasePage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/purchases/:id" element={erpEnabled ? <PurchaseDetailPage tenantKey={tenantKey} role={membership.role} membershipId={membership.id} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/contracts" element={erpEnabled ? <ContractPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/contracts/:id" element={erpEnabled ? <ContractDetailPage tenantKey={tenantKey} role={membership.role} membershipId={membership.id} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/inventory" element={erpEnabled ? <InventoryPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/finance" element={erpEnabled ? <FinancePage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/invoices" element={erpEnabled ? <InvoicePage tenantKey={tenantKey} role={membership.role} membershipId={membership.id} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="erp/receipts" element={erpEnabled ? <ReceiptPage tenantKey={tenantKey} role={membership.role} membershipId={membership.id} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="management-ai" element={<ManagementAiRedirect tenantKey={tenantKey}/>}/>
      <Route path="platform-ai" element={<ManagementAiRedirect tenantKey={tenantKey} operator/>}/>
      <Route path="erp/ai" element={erpEnabled ? <DashboardPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="ai" element={erpEnabled ? <DashboardPage tenantKey={tenantKey} role={membership.role} /> : <Empty text="进销存管理尚未启用，请联系企业管理员。" />} />
      <Route path="knowledge" element={<>{knowledgeEnabled ? <KnowledgePage key={tenantKey} tenantKey={tenantKey} canManage={membership.role === 'admin'} /> : <Empty text="企业知识能力未启用，请联系企业管理员。" />}</>} /><Route path="admin/*" element={<AdminRedirect tenantKey={tenantKey} />} />
      <Route path="channels" element={<ChannelPage tenantKey={tenantKey} isAdmin={membership.role === 'admin'} />} />
      <Route path="account" element={<AccountPage user={me.user} onChanged={onLogout} />} />
      <Route path="*" element={<div><PageTitle title="页面不存在" /><Link to={`${prefix}/erp`}>返回概览</Link></div>} />
    </Routes>}{apps && appAiAllowed && <AiPage key={businessScope} scope={businessScope} apiBase={businessScope!=='erp'?tenantApi(tenantKey,'/apps/'+businessScope+'/ai'):undefined} tenantKey={tenantKey} inventoryReadable={!crmActive&&!mesActive&&permissions.includes('erp.inventory.read')} knowledgeEnabled={knowledgeEnabled} entry={location.pathname.includes('/erp/ai') ? 'erp' : 'enterprise'} open={aiOpen || aiRoute} onClose={() => {setAiOpen(false);if(aiRoute){const back=safeReturn(new URLSearchParams(location.search).get('returnTo'),tenantKey);navigateInShell(back&&!/\/ai(?:\?|$)/.test(back)?back:prefix+'/'+businessScope,{replace:true});}}}/>} </ServiceStatusProvider></main>
  </div>;
}

function AccountPage({ user, onChanged }: { user: Me['user']; onChanged: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (nextPassword !== confirmPassword) { setMessage('两次输入的新密码不一致。'); return; } setBusy(true); setMessage(null);
    try { await api.post('/auth/change-password', { currentPassword, nextPassword }); await onChanged(); }
    catch (error) { setMessage(errorText(error)); setBusy(false); }
  };
  return <><PageTitle title="账号安全"  /><form className="panel form-panel" onSubmit={submit}><h2>修改密码</h2><p>当前账号：{user.account ?? user.email}</p><p>修改成功后，当前账号的所有会话都会失效，需要重新登录。</p><Notice text={message} /><div className="form-grid"><Field label="当前密码"><PasswordInput aria-label="当前密码" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></Field><Field label="新密码（至少 12 位）"><PasswordInput aria-label="新密码" autoComplete="new-password" minLength={12} required value={nextPassword} onChange={e => setNextPassword(e.target.value)} /></Field><Field label="确认新密码"><PasswordInput aria-label="确认新密码" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></Field></div><button className="primary" disabled={busy || !currentPassword || nextPassword.length < 12 || nextPassword !== confirmPassword}>修改密码</button></form></>;
}

function AdminRedirect({ tenantKey }: { tenantKey: string }) { useEffect(() => { window.location.replace(`${import.meta.env.VITE_TENANT_ADMIN_URL ?? 'http://127.0.0.1:4603'}/t/${tenantKey}`); }, [tenantKey]); return <Loading />; }
