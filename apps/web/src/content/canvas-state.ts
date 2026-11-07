import type { EditRegion } from "./ImageRegionDialog";
import type { MediaMode, PictureOptions, ClipOptions } from "./MediaOptions";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorText } from "../api";

export type CanvasNode = {
  id: string;
  type: "image" | "video" | "note";
  x: number;
  y: number;
  width: number;
  height: number;
  assetId?: string;
  text?: string;
};
export type CanvasRecipe = {
  mode: MediaMode;
  picture: PictureOptions & {
    prompt: string;
    nodes: string[];
    region?: EditRegion;
    brand?: { id: string; version: number };
  };
  video: { prompt: string; options: ClipOptions; node?: string };
};
export type CanvasData = {
  recipe?: CanvasRecipe;
  nodes: CanvasNode[];
  viewport: { x: number; y: number; zoom: number };
};
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
/** Merge disjoint edits and completed jobs; never guess when two people changed the same node. */
export function mergeCanvas(
  base: CanvasData,
  local: CanvasData,
  remote: CanvasData,
): CanvasData | null {
  const nodes: CanvasNode[] = [];
  for (const id of new Set(
    [...remote.nodes, ...local.nodes, ...base.nodes].map((n) => n.id),
  )) {
    const b = base.nodes.find((n) => n.id === id),
      l = local.nodes.find((n) => n.id === id),
      r = remote.nodes.find((n) => n.id === id);
    if (!same(b, l) && !same(b, r) && !same(l, r)) return null;
    const n = same(b, l) ? r : l;
    if (n) nodes.push(n);
  }
  if (nodes.length > 100) return null;
  if (
    !same(base.recipe, local.recipe) &&
    !same(base.recipe, remote.recipe) &&
    !same(local.recipe, remote.recipe)
  )
    return null;
  const recipe = same(base.recipe, local.recipe) ? remote.recipe : local.recipe;
  return {
    nodes,
    ...(recipe ? { recipe } : {}),
    viewport: same(base.viewport, local.viewport)
      ? remote.viewport
      : local.viewport,
  };
}
export function useCanvasDraft(
  endpoint: string,
  storageKey: string,
  enabled: boolean,
) {
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [snapshot, setSnapshot] = useState<any>(null),
    [data, render] = useState<CanvasData | null>(null),
    [state, setState] = useState("loading"),
    [error, setError] = useState("");
  const latest = useRef<CanvasData | null>(null),
    baseline = useRef<any>(null),
    busy = useRef<Promise<any> | null>(null),
    blocked = useRef(false),
    mounted = useRef(true);
  const cache = () => {
    if (enabled && latest.current && baseline.current) {
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            data: latest.current,
            base: baseline.current.data,
            version: baseline.current.version,
          }),
        );
      } catch {
        /* Server save remains available. */
      }
    }
  };
  const change = (next: CanvasData | ((old: CanvasData) => CanvasData)) => {
    if (!latest.current || blocked.current) return;
    const value = typeof next === "function" ? next(latest.current) : next;
    if (same(value, latest.current)) return;
    if (!enabled && !same(value.nodes, latest.current.nodes)) return;
    latest.current = value;
    render(latest.current);
    if (enabled) {
      setState("local");
      cache();
    }
  };
  const accept = (remote: any, initial = false) => {
    if (baseline.current && baseline.current.version !== remote.version)
      setHistoryEpoch((v) => v + 1);
    let local = latest.current,
      base = baseline.current?.data;
    if (initial && enabled) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (cached?.data && cached?.base) {
          local = cached.data;
          base = cached.base;
        }
      } catch {
        /* Ignore corrupt browser storage. */
      }
    }
    const merged =
      local && base ? mergeCanvas(base, local, remote.data) : remote.data;
    baseline.current = remote;
    setSnapshot(remote);
    if (!merged) {
      blocked.current = true;
      setState("conflict");
      setError("同一内容已在其他页面修改。当前修改已保留，请重新载入后继续。");
      if (local) {
        latest.current = local;
        render(local);
      }
      return;
    }
    latest.current = merged;
    render(merged);
    setState(same(merged, remote.data) ? "synced" : "local");
    setError("");
    cache();
  };
  const refresh = useCallback(async () => {
    if (blocked.current || busy.current) return;
    try {
      const remote = await api.get<any>(endpoint);
      if (mounted.current) accept(remote, !baseline.current);
    } catch (e) {
      if (mounted.current) {
        setError(errorText(e));
        setState("error");
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          blocked.current = true;
          latest.current = null;
          render(null);
          setSnapshot(null);
          sessionStorage.removeItem(storageKey);
        }
      }
    }
  }, [endpoint, storageKey, enabled]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  const flush = async (): Promise<any> => {
    if (busy.current) {
      await busy.current;
      return flush();
    }
    if (!enabled || !baseline.current || !latest.current || blocked.current)
      throw Error("画布尚未同步，请先重新载入");
    if (same(latest.current, baseline.current.data)) return baseline.current;
    setState("saving");
    const task = (async () => {
      let retries = 0;
      while (!same(latest.current, baseline.current.data)) {
        const input = {
          version: baseline.current.version,
          data: structuredClone(latest.current),
        };
        try {
          const saved = await api.put<any>(endpoint, input);
          // A drag during this request stays local and is saved in the next iteration.
          baseline.current = { ...baseline.current, ...saved };
          if (mounted.current) setSnapshot(baseline.current);
          cache();
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && retries++ < 1) {
            const remote = await api.get<any>(endpoint);
            accept(remote);
            if (!blocked.current) continue;
          }
          if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
            blocked.current = true;
            latest.current = null;
            render(null);
            setSnapshot(null);
            sessionStorage.removeItem(storageKey);
          }
          setState(blocked.current ? "conflict" : "error");
          setError(errorText(e));
          throw e;
        }
      }
      if (mounted.current) {
        setState("synced");
        setError("");
      }
      return baseline.current;
    })();
    busy.current = task;
    try {
      return await task;
    } finally {
      busy.current = null;
    }
  };
  useEffect(() => {
    if (
      !data ||
      !enabled ||
      blocked.current ||
      same(data, baseline.current?.data)
    )
      return;
    const timer = setTimeout(() => void flush().catch(() => {}), 850);
    return () => clearTimeout(timer);
  }, [data, enabled]);
  useEffect(() => {
    const online = () => void refresh();
    window.addEventListener("online", online);
    window.addEventListener("focus", online);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("focus", online);
    };
  }, [refresh]);
  const discard = async () => {
    const remote = await api.get<any>(endpoint);
    sessionStorage.removeItem(storageKey);
    blocked.current = false;
    latest.current = null;
    baseline.current = null;
    accept(remote);
  };
  return {
    snapshot,
    data,
    change,
    state,
    error,
    flush,
    refresh,
    discard,
    blocked: blocked.current,
    historyEpoch,
    dirty: enabled && !!data && !same(data, baseline.current?.data),
  };
}
