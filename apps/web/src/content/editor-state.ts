import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorText } from "../api";

const clone = <T>(data: T): T => structuredClone(data);
const canonical = (data: any): any =>
  Array.isArray(data)
    ? data.map(canonical)
    : data && typeof data === "object"
      ? Object.fromEntries(
          Object.keys(data)
            .sort()
            .map((k) => [k, canonical(data[k])]),
        )
      : data;
const signature = (data: unknown) => JSON.stringify(canonical(data));
export async function artworkHash(data: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(signature(data)),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function syncCopy(data: any) {
  return {
    ...data,
    copy: {
      title:
        data.layers.find((l: any) => l.type === "text" && l.role === "title")
          ?.text ?? "",
      body: data.layers
        .filter(
          (l: any) =>
            l.type === "text" &&
            ["body", "price", "date", "disclaimer"].includes(l.role),
        )
        .map((l: any) => l.text ?? "")
        .filter(Boolean)
        .join("\n"),
      cta:
        data.layers.find((l: any) => l.type === "text" && l.role === "cta")
          ?.text ?? "",
    },
  };
}

/** All controls and canvas gestures share one bounded, reference-only operation history. */
export function useEditorHistory(initial: any) {
  const [data, render] = useState(() => clone(initial));
  const value = useRef(data),
    past = useRef<any[]>([]),
    future = useRef<any[]>([]),
    gesture = useRef<any>(null);
  const [, refresh] = useState(0);
  const setData = useCallback((update: any) => {
    const before = value.current,
      next = syncCopy(typeof update === "function" ? update(before) : update);
    if (signature(before) === signature(next)) return;
    if (!gesture.current) {
      past.current = [...past.current.slice(-79), clone(before)];
      future.current = [];
    }
    value.current = clone(next);
    render(value.current);
  }, []);
  const begin = useCallback(() => {
    if (!gesture.current) gesture.current = clone(value.current);
  }, []);
  const end = useCallback(() => {
    if (
      gesture.current &&
      signature(gesture.current) !== signature(value.current)
    ) {
      past.current = [...past.current.slice(-79), gesture.current];
      future.current = [];
    }
    gesture.current = null;
    refresh((n) => n + 1);
  }, []);
  const reset = useCallback((next: any) => {
    value.current = clone(next);
    past.current = [];
    future.current = [];
    gesture.current = null;
    render(value.current);
  }, []);
  const undo = useCallback(() => {
    end();
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(clone(value.current));
    value.current = previous;
    render(previous);
  }, [end]);
  const redo = useCallback(() => {
    end();
    const next = future.current.pop();
    if (!next) return;
    past.current.push(clone(value.current));
    value.current = next;
    render(next);
  }, [end]);
  return {
    data,
    setData,
    reset,
    begin,
    end,
    undo,
    redo,
    canUndo:
      past.current.length > 0 ||
      Boolean(
        gesture.current && signature(gesture.current) !== signature(data),
      ),
    canRedo: future.current.length > 0,
  };
}

export function useWorkDraft({
  base,
  membershipId,
  artifact,
  current,
  project,
  data,
  reset,
  enabled,
}: any) {
  const endpoint = base + "/artifacts/" + artifact.id + "/draft";
  const cacheKey = `content-work:${base}:${membershipId}:${artifact.id}:${current.version}`;
  const [ready, setReady] = useState(!enabled),
    [state, setState] = useState(enabled ? "loading" : "history"),
    [error, setError] = useState<string | null>(null);
  const active = useRef(true),
    revision = useRef(0),
    latest = useRef(data),
    saved = useRef(signature(current.data)),
    busy = useRef<Promise<any> | null>(null),
    pending = useRef<any>(null),
    blocked = useRef(false);
  const wasEditable = useRef(enabled);
  const abandoned = useRef(false);
  latest.current = data;
  const cache = useCallback(() => {
    if (abandoned.current) return;
    try {
      sessionStorage.setItem(
        cacheKey,
        JSON.stringify({
          data: latest.current,
          serverHash: saved.current,
          revision: revision.current,
          baseVersion: current.version,
          projectVersion: project.version,
          pending: pending.current,
        }),
      );
    } catch {
      /* Server synchronization remains available when browser storage is full. */
    }
  }, [cacheKey, current.version, project.version]);
  const accept = useCallback(
    (draft: any, replace = false) => {
      revision.current = draft?.revision ?? 0;
      saved.current = signature(draft?.data ?? current.data);
      pending.current = null;
      if (replace) {
        latest.current = draft?.data ?? current.data;
        reset(latest.current);
      }
      setState("synced");
      setError(null);
      cache();
    },
    [cache, current.data, reset],
  );
  useEffect(() => {
    active.current = true;
    if (!enabled) return;
    let cancelled = false;
    void api
      .get<any>(endpoint)
      .then((snapshot) => {
        if (cancelled) return;
        let local: any = null;
        try {
          local = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null");
        } catch {
          /* Ignore corrupt browser cache. */
        }
        const server = snapshot.draft?.data ?? current.data;
        revision.current = snapshot.draft?.revision ?? 0;
        saved.current = signature(server);
        const localChanged =
          local &&
          (signature(local.data) !== local.serverHash ||
            Boolean(local.pending));
        const localAccepted =
          local && signature(local.data) === signature(server);
        const pendingAccepted =
          local?.pending &&
          snapshot.draft?.requestKey === local.pending.requestKey &&
          snapshot.draft.revision === local.pending.revision + 1 &&
          signature(snapshot.draft.data) === signature(local.pending.data);
        const safeLocal =
          localChanged &&
          ((local.revision === revision.current &&
            local.serverHash === signature(server)) ||
            pendingAccepted) &&
          local.baseVersion === current.version &&
          local.projectVersion === project.version;
        const conflict =
          snapshot.conflict ||
          snapshot.currentVersion !== current.version ||
          snapshot.projectVersion !== project.version ||
          (localChanged && !safeLocal && !localAccepted);
        latest.current =
          safeLocal || (localChanged && conflict) ? local.data : server;
        reset(latest.current);
        pending.current = safeLocal && !pendingAccepted ? local.pending : null;
        blocked.current = conflict;
        setState(
          conflict
            ? "conflict"
            : signature(latest.current) === saved.current
              ? "synced"
              : "local",
        );
        if (conflict)
          setError(
            "草稿或正式版本已变化，当前编辑已保留。请查看最新版本后处理。",
          );
        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          sessionStorage.removeItem(cacheKey);
          blocked.current = true;
          setState("denied");
        } else {
          let local: any = null;
          try {
            local = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null");
          } catch {
            /* Cache is optional. */
          }
          if (
            local &&
            local.baseVersion === current.version &&
            local.projectVersion === project.version
          ) {
            latest.current = local.data;
            reset(local.data);
            saved.current = local.serverHash;
            revision.current = local.revision;
            pending.current = local.pending;
            setReady(true);
            setState("offline");
          } else setState("unavailable");
        }
        setError(errorText(e));
      });
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [endpoint, cacheKey, enabled]);
  const flush = useCallback(async (): Promise<number> => {
    if (!enabled) return 0;
    if (blocked.current) throw Error("请先处理草稿冲突或访问权限");
    if (!ready) throw Error("工作草稿尚未载入，请重试");
    if (busy.current) {
      await busy.current;
      return flush();
    }
    if (!pending.current && signature(latest.current) === saved.current)
      return revision.current;
    const input = pending.current ?? {
      baseVersion: current.version,
      projectVersion: project.version,
      revision: revision.current,
      requestKey: crypto.randomUUID(),
      data: clone(latest.current),
    };
    pending.current = input;
    cache();
    setState("syncing");
    const promise = api.put<any>(endpoint, input);
    busy.current = promise;
    try {
      const response = await promise;
      revision.current = response.revision;
      saved.current = signature(response.data);
      pending.current = null;
      cache();
      if (active.current) {
        setState(
          signature(latest.current) === saved.current ? "synced" : "local",
        );
        setError(null);
      }
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404, 409].includes(e.status)) {
        blocked.current = true;
        if ([401, 403, 404].includes(e.status)) {
          sessionStorage.removeItem(cacheKey);
          if (active.current) reset(current.data);
        }
        if (active.current) setState(e.status === 409 ? "conflict" : "denied");
      } else if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        pending.current = null;
        if (active.current) setState("invalid");
      } else if (active.current) setState("offline");
      if (active.current) setError(errorText(e));
      throw e;
    } finally {
      busy.current = null;
    }
    if (signature(latest.current) !== saved.current) return flush();
    return revision.current;
  }, [
    enabled,
    ready,
    cache,
    cacheKey,
    current.version,
    project.version,
    endpoint,
  ]);
  useEffect(() => {
    if (wasEditable.current && ready && !["denied"].includes(state)) cache();
    if (!enabled || !ready || blocked.current) return;
    wasEditable.current = true;
    cache();
    if (!pending.current && signature(data) === saved.current) {
      setState("synced");
      setError(null);
      return;
    }
    setState("local");
    const timer = setTimeout(() => void flush().catch(() => {}), 900);
    return () => clearTimeout(timer);
  }, [data, enabled, ready, cache, flush]);
  useEffect(() => {
    const online = () => void flush().catch(() => {});
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [flush]);
  const clear = () => {
    abandoned.current = true;
    sessionStorage.removeItem(cacheKey);
    blocked.current = true;
    setState("synced");
  };
  return {
    ready,
    state,
    error,
    flush,
    accept,
    clear,
    revision,
    unsynced:
      !abandoned.current &&
      (signature(data) !== saved.current || Boolean(pending.current)),
    blocked: blocked.current,
    retry: flush,
  };
}
