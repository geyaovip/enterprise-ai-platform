export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(error?.error?.message ?? `请求失败 (${response.status})`, response.status, error?.error?.code ?? 'HTTP_ERROR');
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, 'POST', body),
  patch: <T>(path: string, body: unknown) => request<T>(path, 'PATCH', body),
  put: <T>(path: string, body: unknown) => request<T>(path, 'PUT', body),
  del: <T>(path: string) => request<T>(path, 'DELETE'),
};

export const tenantApi = (key: string, path: string) => `/tenants/${encodeURIComponent(key)}${path}`;
export const erpApi = (key: string, path: string) => tenantApi(key, `/erp${path}`);
export const aiApi = (key: string, path: string) => tenantApi(key, `/ai${path}`);

export function errorText(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试'; }
