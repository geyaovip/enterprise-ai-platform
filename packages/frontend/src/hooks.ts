import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';

export function useApiData<T>(path: string | null) {
  const [result, setResult] = useState<{path: string | null; data: T | null; loading: boolean; error: string | null}>({path, data: null, loading: Boolean(path), error: null});
  const requestVersion = useRef(0);
  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    if(!path){setResult({path, data: null, error: null, loading: false});return;}
    setResult(previous => ({path, data: previous.path === path ? previous.data : null, loading: true, error: null}));
    try {
      const data = await api.get<T>(path, {timeoutMs: 20000, timeoutMessage: '读取超时，请重试'});
      if (version === requestVersion.current) setResult({path, data, error: null, loading: false});
    } catch (e) {
      if (version === requestVersion.current) setResult({path, data: null, error: errorText(e), loading: false});
    }
  }, [path]);
  useEffect(() => { void reload(); return () => { requestVersion.current += 1; }; }, [reload]);
  // Never render a previous tenant, object or currency while its replacement loads.
  const current = result.path === path ? result : {data: null, loading: Boolean(path), error: null};
  return { data: current.data, loading: current.loading, error: current.error, reload };
}

/** Array-shaped consumer API backed by an explicitly paginated endpoint. */
export function usePagedArray<T>(path: string | null, size = 20) {
  const [view, setView] = useState({path, page:1});
  const page = view.path === path ? view.page : 1;
  const result = useApiData<{items:T[];total:number} | T[]>(path ? `${path}${path.includes('?') ? '&' : '?'}page=${page}&page_size=${size}` : null);
  const data = result.data == null ? null : Array.isArray(result.data) ? result.data.slice((page - 1) * size, page * size) : result.data.items;
  return {...result, data, pagination:{page, size, total:result.data == null ? 0 : Array.isArray(result.data) ? result.data.length : result.data.total, onPage:(next:number) => { if (!result.loading && result.data != null) setView({path,page:next}); }}};
}

export function usePagedData<T>(path: string | null, size = 20) {
  const [view, setView] = useState({path, page:1});
  const page = view.path === path ? view.page : 1;
  const result = useApiData<{items:T[];total:number;page_size?:number}>(path ? `${path}${path.includes('?') ? '&' : '?'}page=${page}&page_size=${size}` : null);
  return {...result,pagination:{page,size,total:result.data?.total??0,onPage:(next:number)=>{ if (!result.loading && result.data != null) setView({path,page:next}); }}};
}
