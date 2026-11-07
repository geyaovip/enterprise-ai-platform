"""Bounded private media decoding, layer composition and deterministic delivery."""
import sys,json,base64,io,os,zipfile,hashlib
from PIL import Image,ImageOps,ImageDraw,ImageFont
Image.MAX_IMAGE_PIXELS=40000000

def decode(data, limit=20*1024*1024):
    b=open(data["path"],"rb").read(limit+1) if isinstance(data,dict) else base64.b64decode(data,validate=True)
    if len(b)>limit: raise ValueError('large')
    im=Image.open(io.BytesIO(b))
    if im.format not in ('PNG','JPEG','WEBP'):raise ValueError('format')
    if im.width*im.height>40000000 or getattr(im,'n_frames',1)>1:raise ValueError('pixels')
    im=ImageOps.exif_transpose(im).convert('RGBA');im.load();return im

def png(im):
    out=io.BytesIO();im.save(out,format='PNG');return base64.b64encode(out.getvalue()).decode()

FONT_PATH=os.path.join(os.path.dirname(__file__),'fonts','NotoSansCJKsc-Regular.otf')
LAYOUT_VERSION='content-noto-sc-v1'

def font(size):
    if not os.path.isfile(FONT_PATH): raise ValueError('font unavailable')
    return ImageFont.truetype(FONT_PATH,size)

def text_patch(l,w,h):
    lw,lh=max(1,round(l['w']*w)),max(1,round(l['h']*h))
    f=font(max(1,round(l['fontSize']*w/1080)));lines=[];line='';too_wide=False
    for c in l.get('text',''):
        if c=='\n': lines.append(line);line='';continue
        if f.getlength(c)>lw:too_wide=True
        if line and f.getlength(line+c)>lw:lines.append(line);line=c
        else:line+=c
    lines.append(line)
    step=max(1,round(f.size*1.35))
    required=max((i*step+(f.getbbox(t,anchor='lt')[3] if t else 0) for i,t in enumerate(lines)),default=0)
    patch=Image.new('RGBA',(lw,lh));draw=ImageDraw.Draw(patch)
    for i,t in enumerate(lines):draw.text((0,i*step),t,font=f,fill=l['color'],anchor='lt',stroke_width=0)
    return patch, {'id':l.get('id','text'),'lines':len(lines),'requiredHeight':required,'availableHeight':lh,'overflow':required>lh or too_wide}

def layout(data,include_images=True):
    result=[];issues=[];w,h=data['width'],data['height']
    for l in data['layers']:
        if l['x']+l['w']>1.00001 or l['y']+l['h']>1.00001:
            issues.append({'id':l.get('id','layer'),'code':'outside','message':'图层超出画布，请调整位置或大小'})
        if l['type']=='text':
            patch,info=text_patch(l,w,h)
            if info['overflow']:issues.append({'id':info['id'],'code':'text_overflow','message':'文字超出图层，请扩大文本框或减小字号'})
            if include_images:info['image']='data:image/png;base64,'+png(patch)
            result.append(info)
    return {'version':LAYOUT_VERSION,'layers':result,'issues':issues}

def render(data,assets,transparent=False):
    if layout(data,False)['issues']:raise ValueError('CONTENT_LAYOUT_OVERFLOW')
    w,h=data['width'],data['height'];im=Image.new('RGBA',(w,h),(0,0,0,0) if transparent else data['backgroundColor'])
    if data.get('backgroundId') and not transparent:im=ImageOps.fit(decode(assets[data['backgroundId']]),(w,h))
    for l in data['layers']:
        x,y,lw,lh=[round(v) for v in (l['x']*w,l['y']*h,l['w']*w,l['h']*h)]
        if l['type']=='image':
            obj=decode(assets[l['assetId']])
            if l.get('crop'):
                r=l['crop'];cx,cy,cw,ch=[round(a*b) for a,b in zip((r['x'],r['y'],r['w'],r['h']),(obj.width,obj.height,obj.width,obj.height))]
                obj=obj.crop((cx,cy,min(obj.width,cx+max(1,cw)),min(obj.height,cy+max(1,ch))))
            obj=ImageOps.contain(obj,(max(1,lw),max(1,lh)));im.alpha_composite(obj,(x+(lw-obj.width)//2,y+(lh-obj.height)//2))
        else:im.alpha_composite(text_patch(l,w,h)[0],(x,y))
    return im

v=json.load(sys.stdin);op=v['op']
if op=='layout':
    print(json.dumps(layout(v['data'])))
elif op=='thumbnail':
    im=decode(v['data'],48*1024*1024 if v.get('large') else 20*1024*1024);im.thumbnail((320,320));print(json.dumps({'data':png(im)}))
elif op=='normalize':
    im=decode(v['data'],40*1024*1024 if v.get('large') else 20*1024*1024);print(json.dumps({'width':im.width,'height':im.height,'data':png(im)}))
elif op=='provider-reference':
    im=decode(v['data'],48*1024*1024)
    scale=min(1,2048/max(im.size))
    scale=max(scale,300/min(im.size))
    if scale!=1: im=im.resize(tuple(round(n*scale) for n in im.size),Image.Resampling.LANCZOS)
    background=Image.new('RGB',im.size,'white')
    background.paste(im,mask=im.getchannel('A'))
    out=io.BytesIO();background.save(out,format='JPEG',quality=94)
    print(json.dumps({'data':base64.b64encode(out.getvalue()).decode()}))
elif op=='image-transform':
    im=decode(v['data'],48*1024*1024)
    if v['operation']=='rotate': im=im.transpose(Image.Transpose.ROTATE_270)
    elif v['operation']=='mirror': im=ImageOps.mirror(im)
    else:
        r=v['region']
        left=min(im.width-1,int(r['x']*im.width));top=min(im.height-1,int(r['y']*im.height))
        right=min(im.width,max(left+1,round((r['x']+r['w'])*im.width)))
        bottom=min(im.height,max(top+1,round((r['y']+r['h'])*im.height)))
        im=im.crop((left,top,right,bottom))
    print(json.dumps({'data':png(im),'width':im.width,'height':im.height}))
elif op=='asset-archive':
    with zipfile.ZipFile(v['output'],'w',zipfile.ZIP_STORED) as archive:
        for asset in v['assets']:
            archive.write(asset['path'],asset['name'])
    print(json.dumps({'ok':True}))
elif op=='fit':
    im=ImageOps.fit(decode(v['data']),(int(v['width']),int(v['height'])));print(json.dumps({'data':png(im),'width':im.width,'height':im.height}))
elif op=='extract':
    z=zipfile.ZipFile(io.BytesIO(base64.b64decode(v['data'],validate=True)));images=[n for n in z.namelist() if n.endswith(('.png','.jpg'))];name=images[v['index']];print(json.dumps({'data':base64.b64encode(z.read(name)).decode(),'mime':'image/jpeg' if name.endswith('.jpg') else 'image/png'}))
elif op=='composite':
    limit=48*1024*1024 if v.get('large') else 20*1024*1024
    old=decode(v['original'],limit);new=ImageOps.fit(decode(v['generated'],limit),old.size);r=v['region'];x,y,w,h=[round(a*b) for a,b in zip((r['x'],r['y'],r['w'],r['h']),(old.width,old.height,old.width,old.height))];old.alpha_composite(new.crop((x,y,x+w,y+h)),(x,y));print(json.dumps({'data':png(old),'width':old.width,'height':old.height}))
elif op=='export':
    target=v.get('output');temp=target+'.tmp' if target else None
    if target:os.makedirs(os.path.dirname(target),mode=0o700,exist_ok=True)
    output=temp if target else io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
        for i,item in enumerate(v['items']):
            art=item['data'];im=render(art,v['assets'],v['format']=='transparent');buf=io.BytesIO()
            if v['draft']:ImageDraw.Draw(im).text((24,24),'DRAFT / 草稿',font=font(32),fill='#c32020')
            ext='jpg' if v['format']=='jpeg' else 'png'
            (im.convert('RGB') if ext=='jpg' else im).save(buf,format='JPEG' if ext=='jpg' else 'PNG')
            name=f'{i+1:03d}-v{item["version"]}-{art["width"]}x{art["height"]}'
            z.writestr(name+'.'+ext,buf.getvalue());z.writestr(name+'.txt','\n\n'.join(art['copy'].values()));z.writestr(name+'.json',json.dumps(art,ensure_ascii=False))
        z.writestr('manifest.json',json.dumps(v['manifest'],ensure_ascii=False,indent=2))
    if target:
        os.chmod(temp,0o600);os.replace(temp,target);print(json.dumps({'bytes':os.path.getsize(target)}))
    else:print(json.dumps({'data':base64.b64encode(output.getvalue()).decode()}))
else:raise ValueError('operation')
