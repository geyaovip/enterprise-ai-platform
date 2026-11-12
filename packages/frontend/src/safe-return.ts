export function safeReturn(value: string | null, tenantKey: string, allowTenantRoot = false) {
  if (!value || value.includes('\\') || value.includes('..') || /[\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, window.location.origin);
    const tenantRoot = `/t/${encodeURIComponent(tenantKey)}`;
    const inTenant = url.pathname.startsWith(tenantRoot + '/') || (allowTenantRoot && url.pathname === tenantRoot);
    return url.origin === window.location.origin && inTenant ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}
