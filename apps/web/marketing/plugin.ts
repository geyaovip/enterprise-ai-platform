import type { Plugin } from 'vite';
import { marketingPage, marketingNotFound, publicPages } from './site';
const privatePage=(path:string)=>['/login','/register','/join','/tenants','/onboarding'].includes(path)||/^\/t\/[^/]+(?:\/|$)/.test(path);
const normalize=(pathname:string)=>pathname==='/'||pathname==='/index.html'?'/':pathname.replace(/\/$/,'');
export function marketingPlugin():Plugin {
  const dev=(req:any,res:any,next:()=>void)=>{
    if(!['GET','HEAD'].includes(req.method??'GET'))return next();
    const url=new URL(req.url??'/','http://localhost');const raw=url.pathname;const path=normalize(raw);
    const canonical=raw.endsWith('/index.html')?normalize(raw.slice(0,-10)):path;
    if((raw!==path||raw.endsWith('/index.html'))&&publicPages.includes(canonical as typeof publicPages[number])){res.statusCode=308;res.setHeader('Location',canonical+url.search);res.end();return;}
    if(!publicPages.includes(path as typeof publicPages[number])){if(path.startsWith('/products/')||(!path.split('/').at(-1)?.includes('.')&&!privatePage(path)&&!path.startsWith('/@')&&!path.startsWith('/api/'))){res.statusCode=404;res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.method==='HEAD'?'':marketingNotFound());return;}return next();}
    res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.method==='HEAD'?'':marketingPage(path as typeof publicPages[number]));
  };
  return {name:'suite-public-pages',enforce:'post',configureServer(server){server.middlewares.use(dev);},configurePreviewServer(server){server.middlewares.use((req,res,next)=>{const path=normalize(new URL(req.url??'/','http://localhost').pathname);if(publicPages.includes(path as typeof publicPages[number])||path.startsWith('/products/')||path==='/index.html'||(!path.split('/').at(-1)?.includes('.')&&!privatePage(path)))return dev(req,res,next);if(privatePage(path))req.url='/app.html';next();});},generateBundle(_options,bundle){
    const app=bundle['index.html'];if(!app||app.type!=='asset')throw Error('Application entry missing');
    this.emitFile({type:'asset',fileName:'app.html',source:app.source});
    app.source=marketingPage('/');
    this.emitFile({type:'asset',fileName:'404.html',source:marketingNotFound()});
    for(const path of publicPages.filter(path=>path!=='/'))this.emitFile({type:'asset',fileName:path.slice(1)+'/index.html',source:marketingPage(path)});
  }};
}
