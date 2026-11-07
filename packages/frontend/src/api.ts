export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public retryAfter?: number) { super(message); }
}

type RequestOptions = { timeoutMs?: number; timeoutMessage?: string };

async function request<T>(path: string, method = 'GET', body?: unknown, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    const response = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal }).catch(error => {
      if (error instanceof TypeError) throw new ApiError('网络连接失败，请检查网络后重试', 0, 'NETWORK_ERROR');
      throw error;
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = data as { error?: { code?: string; message?: string; retryAfter?: number } } | null;
      const fallback: Record<number,string> = {401:'登录已失效，请重新登录',403:'没有权限执行此操作',404:'记录不存在或已被删除',409:'数据已发生变化，请刷新后重试',429:'操作过于频繁，请稍后重试'};
      throw new ApiError(error?.error?.message ?? fallback[response.status] ?? (response.status >= 500 ? '服务暂时不可用，请稍后重试' : '操作未完成，请检查填写内容后重试'), response.status, error?.error?.code ?? 'HTTP_ERROR', Number(error?.error?.retryAfter ?? response.headers.get('Retry-After')) || undefined);
    }
    return data as T;
  };
  if (!options.timeoutMs) return run();
  try {
    return await Promise.race([run(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ApiError(options.timeoutMessage ?? '请求超时，请稍后重试', 0, 'REQUEST_TIMEOUT'));
        controller.abort();
      }, options.timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, 'GET', undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, 'POST', body, options),
  patch: <T>(path: string, body: unknown) => request<T>(path, 'PATCH', body),
  put: <T>(path: string, body: unknown, options?: RequestOptions) => request<T>(path, 'PUT', body, options),
  del: <T>(path: string) => request<T>(path, 'DELETE'),
};

export const tenantApi = (key: string, path: string) => `/tenants/${encodeURIComponent(key)}${path}`;
export const erpApi = (key: string, path: string) => tenantApi(key, `/erp${path}`);
export const aiApi = (key: string, path: string) => tenantApi(key, `/ai${path}`);

export function errorText(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试'; }
