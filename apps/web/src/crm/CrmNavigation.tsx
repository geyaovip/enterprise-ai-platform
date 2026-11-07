import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ForwardIcon, NavIcon } from '@suite/frontend/components';
import { crmNavigation } from './CrmPage';
import './navigation.css';

const groups = [
  { id: 'sales', label: '销售管理', paths: ['customers', 'leads', 'opportunities'] },
  { id: 'operations', label: '客户运营', paths: ['segments', 'tasks', 'service', 'reports'] },
  { id: 'settings', label: '数据与设置', paths: ['imports', 'settings', 'audit'] },
];
const icons: Record<string, string> = {
  '': 'erp', workbench: 'work-items', customers: 'customers', leads: 'quotes',
  opportunities: 'opportunities', segments: 'customers', tasks: 'work-items',
  service: 'collaboration', reports: 'reports', imports: 'opening',
  settings: 'business-settings', audit: 'audit',
};

export function CrmNavigation({ prefix, permissions }: { prefix: string; permissions: readonly string[] }) {
  const { pathname } = useLocation();
  const current = (path: string) => pathname === `${prefix}/crm${path ? '/' + path : ''}`
    || Boolean(path && pathname.startsWith(`${prefix}/crm/${path}/`));
  const activeGroup = groups.find(group => group.paths.some(current))?.id;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({ [activeGroup ?? 'sales']: true }));
  useEffect(() => {
    if (activeGroup) setExpanded(value => value[activeGroup] ? value : { ...value, [activeGroup]: true });
  }, [activeGroup]);
  const visible = crmNavigation.filter(([, , permission]) => permissions.includes(permission));
  const link = ([path, label]: (typeof crmNavigation)[number]) => (
    <Link key={path} to={`${prefix}/crm${path ? '/' + path : ''}`} className={current(path) ? 'active' : ''} aria-current={current(path) ? 'page' : undefined}>
      <NavIcon name={icons[path]} />{label}
    </Link>
  );
  const workspace = visible.filter(([path]) => path === '' || path === 'workbench');
  return <>
    {workspace.length > 0 && <section className="nav-group crm-nav-workspace" aria-label="CRM工作台">{workspace.map(link)}</section>}
    {groups.map(group => {
      const items = group.paths.flatMap(path => visible.filter(([value]) => value === path));
      if (!items.length) return null;
      const open = Boolean(expanded[group.id]), id = `crm-nav-${group.id}`;
      return <section className="nav-group crm-nav-group" key={group.id} aria-label={group.label}>
        <h2><button type="button" className="crm-nav-toggle" aria-expanded={open} aria-controls={id} onClick={() => setExpanded(value => ({ ...value, [group.id]: !value[group.id] }))}>
          <span>{group.label}</span><ForwardIcon size={14} aria-hidden="true" />
        </button></h2>
        <div id={id} hidden={!open}>{items.map(link)}</div>
      </section>;
    })}
  </>;
}
