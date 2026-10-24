import { Link, useLocation } from 'react-router-dom';
import type { LinkProps } from 'react-router-dom';
import { useState, useCallback } from 'react';
import type { SetStateAction } from 'react';

/** Only same-tenant internal routes can be restored. Never accept an external URL. */
export { safeReturn } from '@suite/frontend/safe-return';
export function ContextLink(props: LinkProps) {
  const location = useLocation();
  const to = typeof props.to === 'string' && /\/ai(?:\?|$)/.test(props.to)
    ? props.to + (props.to.includes('?') ? '&' : '?') + 'returnTo=' + encodeURIComponent(location.pathname + location.search)
    : props.to;
  return <Link {...props} to={to} />;
}
/** Store UI filters only. Data and permission checks always come from the API. */
export function useViewState<T>(field: string, initial: T) {
  const location = useLocation();
  const key = 'suite:view:' + sessionStorage.getItem('suite:view-user') + ':' + location.pathname + ':' + field;
  const [value, set] = useState<T>(() => {
    if(new URLSearchParams(location.search).has('focus') || ['query','search','page'].includes(field)&&new URLSearchParams(location.search).has('q'))return initial;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === null) return initial;
      const saved = JSON.parse(raw);
      if (saved === null || typeof saved !== typeof initial || Array.isArray(saved) !== Array.isArray(initial)) return initial;
      if (typeof initial === 'object' && initial !== null && !Array.isArray(initial)) {
        // Older or malformed filter state must not break the page or erase defaults.
        const restored = { ...initial };
        for (const name of Object.keys(initial)) {
          if (typeof saved[name] === typeof (initial as Record<string, unknown>)[name] && saved[name] !== null)
            (restored as Record<string, unknown>)[name] = saved[name];
        }
        return restored;
      }
      return saved;
    } catch { return initial; }
  });
  const update = useCallback((next: SetStateAction<T>) => set(previous => {
    const result = typeof next === 'function' ? (next as (p: T) => T)(previous) : next;
    try { sessionStorage.setItem(key, JSON.stringify(result)); } catch { /* Browsing still works without storage. */ }
    return result;
  }), [key]);
  return [value, update] as const;
}
