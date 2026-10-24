import { brandMarks, brandSvg, type BrandId } from '../packages/frontend/src/brand-marks';
export function brandingPlugin() {
  return {name:'suite-brand-assets',configureServer(server:any){server.middlewares.use((req:any,res:any,next:()=>void)=>{
    const path=(req.url??'').split('?')[0],match=path.match(/^\/brand\/(ark|erp|crm|mes)(?:-(mono|inverse))?\.svg$/);
    if(path!=='/favicon.svg'&&!match)return next();
    res.setHeader('Content-Type','image/svg+xml');res.end(brandSvg((match?.[1]??'ark') as BrandId,(match?.[2]??'color') as 'color'|'mono'|'inverse'));
  });},generateBundle(this:{emitFile:(file:{type:'asset';fileName:string;source:string})=>void}){
    for(const id of Object.keys(brandMarks) as BrandId[]){
      this.emitFile({type:'asset',fileName:`brand/${id}.svg`,source:brandSvg(id)});
      for(const mode of ['mono','inverse'] as const)this.emitFile({type:'asset',fileName:`brand/${id}-${mode}.svg`,source:brandSvg(id,mode)});
    }
    this.emitFile({type:'asset',fileName:'favicon.svg',source:brandSvg('ark')});
    this.emitFile({type:'asset',fileName:'brand/identity.html',source:`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>品牌标识｜知行方舟</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#202535;font:16px/1.7 system-ui,sans-serif}main{max-width:1000px;padding:48px 24px;margin:auto}a{color:#5543c4}h1{font-size:30px;margin:24px 0 8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin:32px 0}.card{padding:32px 24px;background:white;border:1px solid #e3e6ee;border-radius:16px}.card img{display:block;width:80px;height:80px;margin-bottom:28px}.card h2{font-size:18px;margin:0 0 8px}.card p{font-size:14px;color:#606578}.card a{display:inline-block;margin:8px 14px 0 0;font-size:14px}code{font-size:14px}</style><main><a href="/">← 知行方舟官网</a><h1>同一方舟，各有专长。</h1><p>知行方舟与 ERP、CRM、MES 的统一品牌标识。</p><div class="grid">${(Object.keys(brandMarks)as BrandId[]).map(id=>`<article class="card"><img src="/brand/${id}.svg" alt="${brandMarks[id].name}"><h2>${brandMarks[id].name}</h2><p>${brandMarks[id].meaning}</p><a href="/brand/${id}.svg" download="zhixingark-${id}.svg">彩色 SVG</a><a href="/brand/${id}-mono.svg" download="zhixingark-${id}-mono.svg">单色</a><a href="/brand/${id}-inverse.svg" download="zhixingark-${id}-inverse.svg">反白</a></article>`).join('')}</div><p>主色 <code>#6554D9</code> · 图形使用矢量格式，保持比例与留白。</p></main></html>`});
  }};
}
