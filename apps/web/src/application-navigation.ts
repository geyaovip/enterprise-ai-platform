import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { safeReturn } from './business-context';

type Entry = { id: string; name: string; shortName: string; description: string; icon: ReactNode; routePrefix: string; paths: string[] };
type History = { current: string; recent: string[]; pages: Record<string, string> };
const empty = (): History => ({ current: '', recent: [], pages: {} });

/** Hints are scoped to this browser session, user and tenant, never authorization. */
export function useApplicationNavigation(userId: string, tenantKey: string, entries: Entry[], ready: boolean) {
  const key = `suite:applications:${userId}:${tenantKey}`;
  const [history, setHistory] = useState<History>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      return value && typeof value.current === 'string' && Array.isArray(value.recent) && value.pages && typeof value.pages === 'object' ? value : empty();
    } catch { return empty(); }
  });
  const location = useLocation();
  const prefix = `/t/${tenantKey}`;
  const inApp = entries.find(entry => location.pathname === prefix + entry.routePrefix || location.pathname.startsWith(prefix + entry.routePrefix + '/'));
  // The ERP task/AI aliases predate application routes. Shared services retain context.
  const legacyErp = ['/tasks', '/ai'].includes(location.pathname.slice(prefix.length)) ? entries.find(entry => entry.id === 'erp') : undefined;
  const currentId = (inApp ?? legacyErp ?? entries.find(entry => entry.id === history.current) ?? entries[0])?.id ?? '';
  const current = entries.find(entry => entry.id === currentId);
  const page = current?.paths.some(path => location.pathname === prefix + path) ? location.pathname : null;
  useEffect(() => {
    if (!ready || !currentId) return;
    setHistory(previous => {
      if (previous.current === currentId && previous.recent[0] === currentId && (!page || previous.pages[currentId] === page)) return previous;
      const next = { current: currentId, recent: [currentId, ...previous.recent.filter(id => typeof id === 'string' && id !== currentId)].slice(0, 6), pages: { ...previous.pages, ...(page ? { [currentId]: page } : {}) } };
      try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Switching works without browser storage. */ }
      return next;
    });
  }, [key, ready, currentId, page]);
  return { currentId, recentIds: history.recent.filter(id => entries.some(entry => entry.id === id)), apps: entries.map(entry => {
    const hint = history.pages[entry.id];
    const saved = safeReturn(typeof hint === 'string' ? hint : null, tenantKey);
    const savedPath = saved?.split('?')[0];
    const allowed = savedPath && entry.paths.some(path => savedPath === prefix + path);
    return { ...entry, href: allowed ? savedPath : prefix + (entry.paths.includes(entry.routePrefix) ? entry.routePrefix : entry.paths[0] ?? entry.routePrefix) };
  }) };
}
