import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { Notice } from '../components';
import type { DocumentSource } from '../components/AiIntakePanel';

type PageImage={uri:string;width?:number;height?:number;sha256?:string};
export function BomSourceReview({line,documents,base,onBack}:{line:any;documents:DocumentSource[];base:string;onBack:()=>void}){
  const [image,setImage]=useState<PageImage|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[whole,setWhole]=useState(false),[retry,setRetry]=useState(0),[zoom,setZoom]=useState(1);
  const cache=useRef(new Map<string,Promise<PageImage>>()),canvas=useRef<HTMLCanvasElement|null>(null);
  const document=documents.find(d=>d.filename===line?.locator?.filename),loc=line?.locator,remote=Boolean(loc?.visionJobId&&loc?.sourceFileId),key=remote?[loc.visionJobId,loc.sourceFileId,loc.page??1,loc.sha256].join(':'):document?document!.filename+':'+(loc?.page??0)+':'+(loc?.sha256??''):'';
  useEffect(()=>{cache.current.clear();},[documents]);
  useEffect(()=>{
    let active=true;setImage(null);setError(null);setWhole(false);setZoom(1);
    if(!document&&!remote){setBusy(false);return;}
    setBusy(true);
    let promise=cache.current.get(key);
    if(!promise){
      promise=(async()=>{
        if(remote){
          if(!/\.(pdf|png|jpe?g)$/i.test(loc.filename))throw Error('该格式请下载原件在原软件中核对');
          const value=await api.get<any>(base+'/boms/intake/jobs/'+loc.visionJobId+'/sources/'+loc.sourceFileId+'/pages/'+(loc.page??1),{timeoutMs:20000});
          if(value.sha256!==loc.sha256||value.page!==(loc.page??1))throw Error('原图页与来源不一致');
          return {uri:'data:image/png;base64,'+value.data,sha256:value.sha256};
        }
        const raw=Uint8Array.from(atob(document!.data),c=>c.charCodeAt(0));const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(x=>x.toString(16).padStart(2,'0')).join('');
        if(loc?.sha256&&digest!==loc.sha256)throw Error('原件与识别结果不一致，请重新整理');
        if(/\.(png|jpe?g)$/i.test(document!.filename))return {uri:`data:image/${/\.png$/i.test(document!.filename)?'png':'jpeg'};base64,${document!.data}`,sha256:digest};
        if(!/\.pdf$/i.test(document!.filename))throw Error('该格式请在原软件中核对，页面预览支持PDF和图片');
        const page=loc?.page??1,value=await api.post<any>(base+'/boms/intake/page',{document,page});
        if(value.sha256!==digest||value.page!==page)throw Error('原图页与来源不一致，请重新整理');
        return {uri:`data:image/png;base64,${value.data}`,width:value.width,height:value.height,sha256:digest};
      })();
      if(cache.current.size>=3)cache.current.delete(cache.current.keys().next().value!);
      cache.current.set(key,promise);promise.catch(()=>cache.current.delete(key));
    }
    promise.then(value=>{if(active)setImage(value);}).catch(e=>{if(active)setError(errorText(e));}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[key,document,base,retry]);
  const box=loc?.bbox,size=loc?.pageSize,hasBox=Array.isArray(box)&&box.length===4&&Array.isArray(size)&&size.length===2&&box.every(Number.isFinite)&&size.every((n:number)=>Number.isFinite(n)&&n>0)&&box[2]>box[0]&&box[3]>box[1];
  useEffect(()=>{
    if(!image||!hasBox||whole)return;let active=true;
    const original=new Image();original.onload=()=>{
      if(!active||!canvas.current)return;
      const sx=original.naturalWidth/size[0],sy=original.naturalHeight/size[1];
      const x=Math.max(0,box[0]*sx-8),y=Math.max(0,box[1]*sy-8),w=Math.min(original.naturalWidth-x,(box[2]-box[0])*sx+16),h=Math.min(original.naturalHeight-y,(box[3]-box[1])*sy+16);
      if(w<=0||h<=0)return;
      const scale=Math.min(4,1600/w,600/h);canvas.current.width=Math.max(1,Math.round(w*scale));canvas.current.height=Math.max(1,Math.round(h*scale));
      canvas.current.getContext('2d')?.drawImage(original,x,y,w,h,0,0,canvas.current.width,canvas.current.height);
    };original.onerror=()=>{if(active)setError('原图未能显示，可重试或下载原件核对');};original.src=image.uri;return()=>{active=false;};
  },[image,hasBox,whole,JSON.stringify(box),JSON.stringify(size)]);
  return <aside className="bom-source-review" aria-label="原图核对">
    <h4>原图核对</h4>
    {!line&&<p className="muted">选择明细的“定位原图”查看对应区域。</p>}
    {line&&<p>{loc?.filename}{loc?.page?` · 第${loc.page}页`:''}{line.sku?` · ${line.sku}`:''}</p>}
    {busy&&<p role="status">正在读取原图…</p>}
    <Notice text={error}/>{error&&(document||remote)&&<button type="button" disabled={busy} onClick={()=>setRetry(n=>n+1)}>重试原图</button>}
    {line&&<button type="button" className="bom-review-back" onClick={onBack}>返回当前明细</button>}
    {image&&<>
      {hasBox&&<div className="form-actions"><button type="button" aria-pressed={!whole} onClick={()=>setWhole(false)}>本行放大</button><button type="button" aria-pressed={whole} onClick={()=>setWhole(true)}>整页</button></div>}
      <div className="form-actions"><button type="button" disabled={zoom<=1} onClick={()=>setZoom(n=>Math.max(1,n/2))}>缩小原图</button><span>{zoom}倍</span><button type="button" disabled={zoom>=4} onClick={()=>setZoom(n=>Math.min(4,n*2))}>放大原图</button></div>
      <div className="bom-source-viewport">{hasBox&&!whole?<canvas style={{width:100*zoom+'%',maxWidth:'none'}} ref={canvas} role="img" aria-label="当前明细原图放大"/>:<div className="bom-source-page" style={{width:100*zoom+'%'}}><img alt="当前来源原图" src={image.uri}/>{hasBox&&<span className="bom-source-box" aria-label="当前明细位置" style={{left:100*box[0]/size[0]+'%',top:100*box[1]/size[1]+'%',width:100*(box[2]-box[0])/size[0]+'%',height:100*(box[3]-box[1])/size[1]+'%'}}/>}</div>}</div>
      {!remote&&document&&<a download={document!.filename} href={`data:application/octet-stream;base64,${document!.data}`}>下载当前原件</a>}
    </>}
    {remote&&<button type="button" onClick={()=>void(async()=>{try{const source=await api.get<any>(base+'/boms/intake/jobs/'+loc.visionJobId+'/sources/'+loc.sourceFileId,{timeoutMs:20000});if(source.sha256!==loc.sha256)throw Error('原件与识别结果不一致');const bytes=Uint8Array.from(atob(source.data),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes])),a=window.document.createElement('a');a.href=url;a.download=source.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(errorText(e));}})()}>下载当前原件</button>}
  </aside>;
}
