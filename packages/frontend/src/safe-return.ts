export function safeReturn(value: string | null, tenantKey: string) {
  if (!value || value.includes('\\') || value.includes('..') || /[\u0000-\u001f]/.test(value)) return null;
  try { const url = new URL(value, window.location.origin); return url.origin === window.location.origin && url.pathname.startsWith(`/t/${encodeURIComponent(tenantKey)}/`) ? url.pathname + url.search : null; } catch { return null; }
}
