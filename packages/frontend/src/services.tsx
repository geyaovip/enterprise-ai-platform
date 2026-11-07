import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { tenantApi } from './api';
import { useApiData } from './hooks';
import { Notice } from './components';

type ServiceStatus = { serviceTenantKey?:string; ai: { enabled: boolean; configured: boolean;mode?:'connected'|'notice';modelInvocationEnabled?:boolean;message?:string|null }; knowledge: { enabled: boolean; configured: boolean } };
type ServiceContext = { data: ServiceStatus | null; loading: boolean; error: string | null; reload: () => Promise<void> };
const Services = createContext<ServiceContext | null>(null);

export function ServiceStatusProvider({ tenantKey, children, statusPath }: { tenantKey: string; children: ReactNode; statusPath?:string }) {
  const status = useApiData<ServiceStatus>(statusPath ?? tenantApi(tenantKey, '/service-status'));
  useEffect(() => { const refresh = () => { void status.reload(); }; window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [status.reload]);
  return <Services.Provider value={status}>{children}</Services.Provider>;
}

export function useServices() {
  const status = useContext(Services);
  return { ...status, aiAvailable: Boolean(status?.data?.ai.enabled && (status.data.ai.mode==='notice'||status.data.ai.configured)), knowledgeAvailable: Boolean(status?.data?.knowledge.enabled && status.data.knowledge.configured) };
}

export function ServiceNotice({ kind }: { kind: 'ai' | 'knowledge' }) {
  const status = useServices();
  if (status.loading && !status.data) return <Notice tone="info" text="正在检查服务配置…" />;
  if (status.error) return <div className="service-notice"><Notice text={`暂时无法确认服务状态：${status.error}`} /><button type="button" onClick={() => void status.reload?.()}>重新检查</button></div>;
  const service = status.data?.[kind];
  if(kind==='ai'&&status.data?.ai.mode==='notice')return null;
  if (service?.enabled && service.configured) return null;
  return <Notice tone="info" text={kind === 'ai' ? service?.enabled ? 'AI 助手未配置。' : 'AI 助手未启用。' : service?.enabled ? '文档搜索未配置。' : '文档搜索未启用。'} />;
}
