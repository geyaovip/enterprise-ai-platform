import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';

export function useApiData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    if(!path){setData(null);setError(null);setLoading(false);return;}
    setLoading(true);
    try { const result = await api.get<T>(path); if (version === requestVersion.current) { setData(result); setError(null); } }
    catch (e) { if (version === requestVersion.current) { setData(null); setError(errorText(e)); } }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [path]);
  useEffect(() => { void reload(); return () => { requestVersion.current += 1; }; }, [reload]);
  return { data, loading, error, reload };
}
