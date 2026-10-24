const publicRoutes = new Map([
  ['/', '/index.html'], ['/products', '/products/index.html'],
  ['/products/erp', '/products/erp/index.html'], ['/products/crm', '/products/crm/index.html'], ['/products/mes', '/products/mes/index.html'],
]);
const publicAliases = new Map([...publicRoutes].map(([route, asset]) => [asset, route]));
const accountRoutes = new Set(['/login', '/register', '/join', '/tenants', '/onboarding']);
export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', { status: 405 });
    const url = new URL(request.url);
    const prefix = env.FRONTEND_PREFIX || '';
    if (prefix && url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return new Response('Not Found', { status: 404 });
    const path = url.pathname.slice(prefix.length) || '/';
    let status;
    let publicPage = false;
    if (!prefix) {
      const normalized = path.length > 1 ? path.replace(/\/$/, '') : path;
      const canonicalPath = publicAliases.get(path) ?? normalized;
      const discovery = ['/robots.txt', '/sitemap.xml'].includes(path);
      let origin = url.origin;
      if (env.PUBLIC_SITE_ORIGIN) {
        const configured = new URL(env.PUBLIC_SITE_ORIGIN);
        if (configured.protocol === 'https:' && configured.pathname === '/') origin = configured.origin;
      }
      // Consolidate anonymous marketing URLs only. Existing business sessions stay on their origin.
      if ((publicRoutes.has(canonicalPath) || discovery) &&
          (url.origin !== origin || path !== canonicalPath)) {
        return Response.redirect(origin + canonicalPath + url.search, 308);
      }
      if (path === '/robots.txt') {
        // Let crawlers read noindex on account/business HTML; robots.txt is not access control.
        const robots = 'User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ' + origin + '/sitemap.xml\n';
        return new Response(request.method === 'HEAD' ? null : robots, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' } });
      }
      if (path === '/sitemap.xml') {
        const xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + [...publicRoutes.keys()].map(path => '<url><loc>' + origin.replaceAll('&', '&amp;') + path + '</loc></url>').join('') + '</urlset>';
        return new Response(request.method === 'HEAD' ? null : xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' } });
      }
      publicPage = publicRoutes.has(path);
      if (publicPage) { url.pathname = publicRoutes.get(path); url.search = ''; }
      else if (!path.split('/').at(-1).includes('.')) {
        const privateRoute = accountRoutes.has(normalized) || /^\/t\/[^/]+(?:\/|$)/.test(path);
        url.pathname = privateRoute ? '/app.html' : '/404.html'; url.search = '';
        if (!privateRoute) status = 404;
      } else if (path === '/products' || path.startsWith('/products/')) {
        url.pathname = '/404.html'; url.search = ''; status = 404;
      }
    } else {
      url.pathname = path;
      if (!path.split('/').at(-1).includes('.')) { url.pathname = '/'; url.search = ''; }
    }
    const response = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    const html = headers.get('content-type')?.includes('text/html');
    // Product screenshots and icons must remain discoverable. noindex belongs to private HTML/errors.
    if ((html && (prefix || !publicPage)) || (status ?? response.status) >= 400) headers.set('X-Robots-Tag', 'noindex, nofollow');
    else headers.delete('X-Robots-Tag');
    if (html) headers.set('Cache-Control', 'no-cache');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: status ?? response.status, headers });
  },
};
