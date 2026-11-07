import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  execute: (widget: string) => void;
  reset: (widget: string) => void;
  remove: (widget: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }
export type TurnstileHandle = { verify: () => Promise<string> };
let scriptPromise: Promise<TurnstileApi> | undefined;
function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timer); script.remove(); scriptPromise = undefined; reject(new Error('安全验证加载失败，请检查网络后重试')); };
    const timer = setTimeout(fail, 12_000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.defer = true;
    script.onload = () => { clearTimeout(timer); if (window.turnstile) resolve(window.turnstile); else fail(); };
    script.onerror = fail; document.head.append(script);
  });
  return scriptPromise;
}

/** Managed + interaction-only: normal users do not see an extra checkbox. */
export const Turnstile = forwardRef<TurnstileHandle, { siteKey: string; timeoutMs?: number; onVerified?: () => void }>(function Turnstile({ siteKey, timeoutMs = 300000, onVerified }, ref) {
  const [active, setActive] = useState(false);
  const container = useRef<HTMLDivElement>(null), widget = useRef<string | undefined>(undefined);
  const freshProof = useRef<{ token: string; expiresAt: number } | null>(null);
  const generation = useRef(0), pending = useRef<{ resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const finish = (token?: string) => {
    setActive(false);
    const item = pending.current; pending.current = null;
    if (token) onVerified?.(); else freshProof.current = null;
    if (!item) { if (token) freshProof.current = { token, expiresAt: Date.now() + 240000 }; return; }
    clearTimeout(item.timer);
    if (token) item.resolve(token); else item.reject(new Error('安全验证未完成，请重试'));
  };
  useEffect(() => {
    const current = ++generation.current;
    void loadScript().catch(() => {});
    return () => {
      if (generation.current === current) generation.current++;
      finish(); freshProof.current = null;
      if (widget.current !== undefined) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [siteKey]);
  useImperativeHandle(ref, () => ({
    async verify() {
      const proof = freshProof.current; freshProof.current = null;
      if (proof && proof.expiresAt > Date.now()) return proof.token;
      const current = generation.current;
      setActive(true);
      let api: TurnstileApi;
      try { api = await loadScript(); } catch (error) { setActive(false); throw error; }
      if (current !== generation.current || !container.current) throw new Error('安全验证已取消，请重试');
      if (pending.current) throw new Error('安全验证正在进行');
      if (widget.current === undefined) {
        widget.current = api.render(container.current, {
          sitekey: siteKey, action: 'email_code', execution: 'execute', appearance: 'interaction-only',
          theme: 'light', language: 'zh-cn', size: 'compact',
          callback: (token: string) => finish(token),
          'error-callback': () => { finish(); return true; },
          'expired-callback': () => finish(), 'timeout-callback': () => finish(),
        });
      } else api.reset(widget.current);
      return new Promise<string>((resolve, reject) => {
        pending.current = { resolve, reject, timer: setTimeout(() => finish(), Math.min(300000, Math.max(1000, timeoutMs))) };
        try { api.execute(widget.current!); } catch { finish(); }
      });
    },
  }), [siteKey, timeoutMs, onVerified]);
  return <div ref={container} className="auth-human-check" hidden={!active} aria-label="安全验证"/>;
});
