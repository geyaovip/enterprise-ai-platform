export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if ((url.hostname === 'zhixingark.cn' || url.hostname === 'www.zhixingark.cn') &&
        (url.hostname !== 'zhixingark.cn' || url.protocol !== 'https:')) {
      url.hostname = 'zhixingark.cn'; url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }
    for (const prefix of ['/tenant-admin', '/platform-admin']) {
      if (url.pathname === prefix) {
        url.pathname += '/';
        return Response.redirect(url.toString(), 308);
      }
    }
    if (!url.pathname.startsWith('/api/')) {
      const frontend = url.pathname.startsWith('/tenant-admin/') ? env.TENANT_ADMIN
        : url.pathname.startsWith('/platform-admin/') ? env.PLATFORM_ADMIN
          : env.WORKSPACE;
      try {
        return await frontend.fetch(request);
      } catch {
        return new Response('页面暂时不可用', { status: 502 });
      }
    }

    if (!env.API_ORIGIN) {
      return Response.json({ error: { code: 'API_NOT_CONFIGURED', message: 'API 尚未配置' } }, { status: 503 });
    }

    const origin = new URL(env.API_ORIGIN);
    if (origin.protocol !== 'https:') {
      return Response.json({ error: { code: 'API_ORIGIN_INVALID', message: 'API 地址无效' } }, { status: 503 });
    }
    origin.pathname = origin.pathname.replace(/\/$/, '') + url.pathname;
    origin.search = url.search;
    const headers = new Headers(request.headers);
    headers.delete('host');

    try {
      const upstream = await fetch(new Request(origin, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
      }));
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('Cache-Control', 'no-store');
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch {
      return Response.json({ error: { code: 'API_UNAVAILABLE', message: '服务暂时不可用' } }, { status: 502 });
    }
  },
};
