"""Read-only BOM tables. Preserve cells, pages and coordinates; never infer hidden parts."""
import base64, csv, hashlib, io, json, os, re, subprocess, sys, tempfile, time, unicodedata, zipfile, posixpath, warnings
import signal
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree as ET
from PIL import Image, ImageOps, ImageEnhance

# Keep OpenCV/BLAS inside the same process and memory/time limits as OCR.
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')
Image.MAX_IMAGE_PIXELS = 12_000_000
DEADLINE = time.monotonic() + 115
def interrupted(signum, frame):raise ValueError('DOCUMENT_TIMEOUT')
signal.signal(signal.SIGTERM,interrupted)
if hasattr(signal,'SIGXCPU'):signal.signal(signal.SIGXCPU,interrupted)
ALIASES = {
 'item': ['序号','项次','项号','item','itemnumber','itemno','item#','no'],
 'sku': ['物料编码','物料编号','零件编号','零件编码','组件编码','组件编号','件号','料号','图号','代号','partnumber','partname','partno','materialcode','sku'],
 'name': ['物料名称','零件名称','组件名称','线束名称','产品名称','productname','名称','品名','description','materialname','name'],
 'modelHint': ['designation','标称值','元件值'],
 'comment': ['comment','注释'],
 'value': ['value'],
 'spec': ['spec','specification','规格','规格型号','材料规格','线材规格','材料要求','说明'],
 'length': ['length','长度','线长'],
 'connector': ['connector','连接器'],
 'terminal': ['terminal','端子'],
 'footprint': ['footprint','package','封装'],
 'quantity': ['单件用量','每件用量','组件数量','单机数量','用量','数量','qty','quantity','qnty','quantityperpcb','qtyperboard','单板数量'],
 'unit': ['计量单位','单位','unit','uom'],
 'parent': ['父件编码','父件编号','父项编码','父项','父件','装配编号','产品编码','parentsku','parent','assembly'],
 'level': ['层级','级别','level'],
 'wastePercent': ['损耗率','损耗率%','损耗%','wastepercent'],
 'mpn': ['mpn','manufacturerpart','manufacturerpartnumber','manufacturercode','manufcode','mfrpartnumber','制造商料号','厂家料号','厂商料号'],
 'manufacturer': ['manufacturer','manu','mfr','制造商','厂家','厂商'],
 'designators': ['designator','designators','reference','references','customerreference','refdes','位号','元件位号'],
 'population': ['population','fitted','fit','mount','装配状态','是否装配','贴装状态'],
 'dnp': ['dnp','dni','donotpopulate'],
 'excludeFromBom': ['excludefrombom'],
 'revision': ['revision','rev','版本','版次','图纸版本'],
}

def key(value):
 return re.sub(r'[\s.：:_%()（）-]', '', unicodedata.normalize('NFKC', value)).lower()

def field(value):
 # Scanned border strokes and typographic quote marks can surround a header.
 # Strip only edge punctuation; retain exact alias matching (no fuzzy headers).
 normalized=key(value.strip(" \t\r\n|│[]\"'‘’“”"))
 return next((name for name,values in ALIASES.items() if normalized in [key(v) for v in values]), None)

def is_header(mapped):
 values=set(mapped.values())
 identity=bool(values&{'sku','name','mpn','modelHint','comment','value'})
 return (('quantity' in values or any(v.startswith('variant:')for v in values))and identity)or('sku'in values and bool(values&{'item','name'}))

def header_fields(cells):
 mapped={i:field(c)for i,c in enumerate(cells)if field(c)}
 if any(key(c)in ['productname','产品名称','物料名称','零件名称','组件名称','线束名称']for c in cells):
  mapped={i:('spec'if f=='name'and key(cells[i])=='description'else f)for i,f in mapped.items()}
 for i,c in enumerate(cells):
  # An explicitly named configuration quantity is not a generic Quantity column.
  if i not in mapped and re.fullmatch(r'.+?(?:单机数量|单件用量|数量|\bquantity|\bqty)',str(c).strip(),re.I|re.S):
   mapped[i]='variant:'+str(c).strip()
 # PartNumber in an electronic export denotes its printed manufacturer/source
 # identity, but a mechanical Part Number remains an internal part candidate.
 if 'mpn'not in mapped.values()and set(mapped.values())&{'designators','manufacturer','footprint'}:
  mapped={i:('mpn'if f=='sku'and key(cells[i])in ['partnumber','partno']else f)for i,f in mapped.items()}
 return mapped

def title_role(cells):
 text='|'.join(key(str(c))for c in cells)
 cues=['表面处理','热处理','图纸代号','未标注公差','图纸大小','绘制','审核','核准','页次','比例','tolerance','drawnby','checkedby']
 return sum(cue in text for cue in cues)>=2

def parts_header(cells,mapped):
 return is_header(mapped)and not(title_role(cells)and not set(mapped.values())&{'item','mpn','designators'})

def run(args, data=None, timeout=15):
 remaining=DEADLINE-time.monotonic()
 if remaining<=0: raise ValueError('DOCUMENT_TIMEOUT')
 try:result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=min(timeout,remaining),env={**os.environ,'OMP_THREAD_LIMIT':'1'})
 except subprocess.TimeoutExpired:raise ValueError('DOCUMENT_TIMEOUT')from None
 if result.returncode or len(result.stdout)>4*1024*1024: raise ValueError('DOCUMENT_PROCESS_FAILED')
 return result.stdout

def text_cell(words):
 lines=[]
 for w in sorted(words,key=lambda x:(x['y'],x['x'])):
  line=next((l for l in lines if abs(l[0]['y']-w['y'])<max(2,w['h']*.5)),None)
  if line is None: lines.append([w])
  else: line.append(w)
 return ' '.join(' '.join(w['text'] for w in sorted(line,key=lambda w:w['x'])) for line in lines).strip()

def ocr_cell(image, numeric=False, details=False, latin=False):
 if image.width<2 or image.height<2:return ('',0,[])if details else ('',0)
 original=image
 if numeric:
  gray=image.convert('L')
  ink=ImageOps.invert(gray).point(lambda p:255 if p>80 else 0).getbbox()
  if not ink:return ('',0,[])if details else ('',0)
  original=gray.crop(ink)
 evidence={}
 def recognize(target_height=None):
  cell=original
  if target_height:
   scale=min(4 if target_height==32 else 6,target_height/max(1,cell.height))if numeric in ['quantity','quantity-literal']else min(6,max(1,target_height/max(1,cell.height)))
   cell=cell.resize((max(1,round(cell.width*scale)),max(1,round(cell.height*scale))),Image.Resampling.LANCZOS)
  cell=ImageOps.expand(cell.convert('RGB'),border=20 if numeric else 12,fill='white')
  if not numeric and cell.height<80:
   scale=min(4,max(2,round(100/cell.height)));cell=cell.resize((cell.width*scale,cell.height*scale),Image.Resampling.LANCZOS)
  buf=io.BytesIO();cell.save(buf,format='PNG')
  digest=hashlib.sha256(buf.getvalue()).digest()
  if digest in evidence:return evidence[digest]
  args=[os.environ.get('KNOWLEDGE_TESSERACT_PATH','tesseract'),'stdin','stdout','-l','eng' if numeric or latin else 'chi_sim+eng','--oem','1','--psm','7' if numeric else '6','-c','load_system_dawg=0','-c','load_freq_dawg=0']
  if numeric and numeric!='quantity-literal':args+=['-c','tessedit_char_whitelist=0123456789.,/-']
  data=run(args+['tsv'],buf.getvalue()).decode('utf8');tokens=[]
  for row in csv.DictReader(io.StringIO(data),delimiter='\t'):
   value=(row.get('text')or'').strip()
   if value:tokens.append({'text':value,'x':int(row['left']),'y':int(row['top']),'w':int(row['width']),'h':int(row['height']),'conf':float(row['conf'])})
  evidence[digest]=(' '.join(t['text']for t in tokens),min((t['conf']for t in tokens),default=0),tokens)
  return evidence[digest]
 result=recognize(48 if numeric else None)
 if numeric=='quantity-literal':
  alternate=recognize(80)
  compact=lambda v:re.sub(r'\s+','',v).upper()
  agreed=compact(result[0])==compact(alternate[0])and min(result[1],alternate[1])>=60 and max(result[1],alternate[1])>=85
  result=(result[0],max(result[1],alternate[1])if agreed else 0,result[2])
 if numeric=='quantity':
  # A second bounded scale checks the glyph, never guesses from neighbouring rows.
  alternate=recognize(32)
  valid=re.fullmatch(r'(?:\d+(?:\.\d+)?|\.\d+|\d+/\d+)',result[0]or'')
  if result is alternate or not valid or result[0]!=alternate[0] or min(result[1],alternate[1])<60 or max(result[1],alternate[1])<85:
   # Larger glyphs preserve older clear-scan cases; at most four local scales.
   readings=list({id(r):r for r in [result,alternate,recognize(64),recognize(96)]}.values());agreed={}
   for value,score,tokens in readings:
    if score>=60 and re.fullmatch(r'(?:\d+(?:\.\d+)?|\.\d+|\d+/\d+)',value or''):agreed.setdefault(value,[]).append(score)
   accepted=[(value,max(scores))for value,scores in agreed.items()if len(scores)>=2 and max(scores)>=85]
   if len(accepted)==1:result=(*accepted[0],result[2])
   else:
    best=max(readings,key=lambda r:r[1]);result=(best[0],0,best[2])
  else:result=(result[0],max(result[1],alternate[1]),result[2])
 return result if details else result[:2]

def numeric_column(image,x0,x1,intervals,quantity=False):
 # Batch a column of independent grid cells. White gutters preserve row identity;
 # TSV boxes crossing a gutter are rejected rather than assigned to a neighbour.
 if len(intervals)<5 or x1-x0<7:return {}
 reads=[]
 for height in [48,32]:
  tiles=[];slots=[];offset=0
  for index,(y0,y1)in enumerate(intervals):
   cell=image.crop((x0+3,y0+3,x1-2,y1-2)).convert('RGB')
   if cell.height<2 or cell.width<2:return {}
   scale=min(4 if height==32 else 6,height/cell.height)
   cell=cell.resize((max(1,round(cell.width*scale)),max(1,round(cell.height*scale))),Image.Resampling.LANCZOS)
   tile=ImageOps.expand(cell,border=16,fill='white');tiles.append(tile);slots.append((index,offset+16,offset+16+cell.height));offset+=tile.height
  width=max(t.width for t in tiles)
  if width*offset>12_000_000 or offset>16000:return {}
  strip=Image.new('RGB',(width,offset),'white');top=0
  for tile in tiles:strip.paste(tile,(0,top));top+=tile.height
  buf=io.BytesIO();strip.save(buf,format='PNG')
  raw=run([os.environ.get('KNOWLEDGE_TESSERACT_PATH','tesseract'),'stdin','stdout','-l','eng','--oem','1','--psm','6','-c','tessedit_char_whitelist=0123456789.,/-','-c','load_system_dawg=0','-c','load_freq_dawg=0','tsv'],buf.getvalue()).decode('utf8')
  tokens=[r for r in csv.DictReader(io.StringIO(raw),delimiter='\t')if(r.get('text')or'').strip()];values={}
  for index,start,end in slots:
   selected=[r for r in tokens if start<=int(r['top'])and int(r['top'])+int(r['height'])<=end]
   value=' '.join(r['text'].strip()for r in selected);score=min((float(r['conf'])for r in selected),default=0)
   values[index]=(value,score)
  reads.append(values)
 out={}
 for index in reads[0]:
  first,second=reads[0][index],reads[1][index]
  valid=re.fullmatch(r'(?:\d+(?:\.\d+)?|\.\d+|\d+/\d+)',first[0]or'')
  agreed=bool(valid and first[0]==second[0]and min(first[1],second[1])>=60 and max(first[1],second[1])>=85)
  if quantity:out[index]=(first[0]or second[0],max(first[1],second[1])if agreed else 0)
  else:out[index]=first if first[1]>=second[1]else second
 return out

def grouped(values, tolerance=3):
 groups=[]
 for value in sorted(values):
  if groups and value-groups[-1][-1]<=tolerance: groups[-1].append(value)
  else: groups.append([value])
 return [round(sum(g)/len(g)) for g in groups]

def grids(image):
 gray=image.convert('L');width,height=gray.size
 data=gray.point(lambda p:1 if p<185 else 0,'L').tobytes()
 pattern=re.compile(b'\x01{%d,}'%max(100,round(width*.10)))
 segments=[]
 for y in range(height):
  for match in pattern.finditer(data[y*width:(y+1)*width]):
   x0,x1=match.span()
   group=next((g for g in segments if abs(g['x0']-x0)<5 and abs(g['x1']-x1)<5),None)
   if group is None: segments.append({'x0':x0,'x1':x1,'ys':[y]})
   else: group['ys'].append(y)
 found=[]
 for group in segments:
  ys=grouped(group['ys'])
  if len(ys)<3 or len(ys)>205: continue
  x0,x1=group['x0'],group['x1'];top,bottom=ys[0],ys[-1]
  if bottom-top<30: continue
  crop=gray.crop((x0,top,x1+1,bottom+1)).transpose(Image.Transpose.TRANSPOSE)
  cw,ch=crop.size;raw=crop.point(lambda p:1 if p<185 else 0,'L').tobytes()
  vertical=re.compile(b'\x01{%d,}'%max(20,round(cw*.52)))
  xs=grouped([x0+i for i in range(ch) if vertical.search(raw[i*cw:(i+1)*cw])])
  if not xs or abs(xs[0]-x0)>5: xs.insert(0,x0)
  if abs(xs[-1]-x1)>5: xs.append(x1)
  if 3<=len(xs)<=16: found.append((xs,ys))
 # Rotated sheets can look like many unrelated grids. They are not document size.
 if len(found)>12:return []
 return found

def line_grids(image):
 import cv2,numpy as np
 gray=np.asarray(image.convert('L'));ink=255-gray
 h,w=gray.shape
 horizontal=cv2.morphologyEx(ink,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(max(40,w//40),1)))
 contours,_=cv2.findContours(horizontal,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
 groups=[]
 for c in contours:
  x,y,cw,ch=cv2.boundingRect(c)
  if cw<max(100,w*.08)or ch>max(12,h*.01):continue
  group=next((g for g in groups if abs(g['left']-x)<max(10,cw*.03)and abs(g['right']-(x+cw))<max(10,cw*.03)),None)
  if group is None:group={'left':x,'right':x+cw,'ys':[]};groups.append(group)
  group['ys'].append(y+ch/2)
 vertical=cv2.morphologyEx(ink,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(1,max(20,h//50))))
 contours,_=cv2.findContours(vertical,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
 rectangles=[cv2.boundingRect(c)for c in contours];out=[]
 separated=[]
 for g in groups:
  ys=grouped(g['ys'])
  gaps=np.diff(ys);typical=float(np.median(gaps))if len(gaps)else 20
  chunks=[[]]
  for y in ys:
   if chunks[-1]and y-chunks[-1][-1]>max(120,typical*6):chunks.append([])
   chunks[-1].append(y)
  separated.extend({**g,'ys':chunk}for chunk in chunks)
 for g in separated:
  ys=grouped(g['ys']);top,bottom=ys[0],ys[-1]
  if len(ys)<3 or len(ys)>205 or bottom-top<30:continue
  # Slightly bowed scan borders can start to the left of a horizontal group's
  # first observed segment. Use the same bounded edge tolerance as below.
  edge_tolerance=max(5,w*.01)
  xs=grouped([x+cw/2 for x,y,cw,ch in rectangles if g['left']-edge_tolerance<=x<=g['right']+edge_tolerance and min(y+ch,bottom)-max(y,top)>(bottom-top)*.52 and cw<max(12,w*.025)])
  if len(xs)<3 or len(xs)>16:continue
  if abs(xs[0]-g['left'])>max(20,w*.01)or abs(xs[-1]-g['right'])>max(20,w*.01):continue
  out.append((xs,ys))
 # A fragmented line group must not duplicate a larger enclosing table.
 return [g for i,g in enumerate(out)if not any(i!=j and h[0][0]<=g[0][0]+5 and h[0][-1]>=g[0][-1]-5 and h[1][0]<=g[1][0] and h[1][-1]>=g[1][-1] and len(h[1])>len(g[1])for j,h in enumerate(out))][:12]

def parse_rows(rows, filename, page=None, sheet=None, method='structured', boxes=None, confidences=None,row_numbers=None):
 tables=[];columns=None;table=None
 order=list(range(len(rows)))
 # Some engineering tables print column headings below the rows. Reorder only
 # iteration, retaining physical source-row numbers and boxes; no synthetic rows.
 for hi,cells in enumerate(rows[:13]):
  mapped=header_fields(cells)
  if parts_header(cells,mapped):
   ii=next((i for i,f in mapped.items()if f=='item'),None)
   if hi and ii is not None and all(ii<len(r)and re.fullmatch(r'\d+',r[ii].strip())for r in rows[:hi]):order=[hi]+list(range(hi))
   break
 for index in order:
  cells=rows[index];mapped=header_fields(cells)
  if parts_header(cells,mapped):
   columns=mapped
   ambiguous=[f for f in set(mapped.values()) if list(mapped.values()).count(f)>1]
   table={'file':filename,'page':page,'sheet':sheet,'table':len(tables)+1,'method':method,'ambiguousColumns':ambiguous,'columnMapping':[{'column':i+1,'header':cells[i],'field':f}for i,f in mapped.items()],'rows':[]}
   tables.append(table);continue
  if not columns: continue
  anchored=any(i<len(cells)and((f=='item'and re.fullmatch(r'\d+',cells[i].strip()))or(f in ['sku','mpn']and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.\-/]{2,}',cells[i].strip())))for i,f in columns.items())
  if title_role(cells)and not anchored:columns=None;continue
  if not any(str(c).strip() for c in cells):
   # A detected grid row may be unreadable. Preserve it rather than silently dropping it.
   if not boxes: continue
  row={name:str(cells[i]).strip() if i<len(cells) else '' for i,name in columns.items()}
  for ambiguous in table.get('ambiguousColumns',[]):row[ambiguous]=''
  variants={f[8:]:row.pop(f)for f in list(row)if f.startswith('variant:')}
  if variants:
   row['quantities']=variants;row['quantity']=''
   row.setdefault('reviewReasons',[]).append('来源含机型数量列；请明确适用机型并核对用量，不自动选择或合计')
  hints=[row[f]for f in ['modelHint','comment','value']if row.get(f)]
  if not row.get('modelHint')and hints:row['modelHint']=hints[0]
  if len(set(hints))>1:row.setdefault('reviewReasons',[]).append('标称值与注释不同，已分别保留原列，请核对规格')
  if not row.get('name')and'name'not in columns.values()and row.get('modelHint'):
   row['name']=row['modelHint'];row['identityHintOnly']=True
   row.setdefault('reviewReasons',[]).append('来源只有标称值或注释，不据此自动确定企业物料')
  # Inverse DNP flags must not be read as a FITTED boolean: DNP=false does
  # not mean "not fitted". Preserve positive exclusions, flag unknown values.
  positive={'1','true','yes','y','x','dnp','dni','dne','是'};negative={'','0','false','no','n','否'}
  for flag,excluded in [('dnp','DNI'),('excludeFromBom','EXCLUDED FROM BOM')]:
   value=row.get(flag,'').strip().lower()
   if value in positive:
    if row.get('population')and row['population'].strip().upper()in ['YES','TRUE','FIT','FITTED']:
     row.setdefault('reviewReasons',[]).append('装配与排除标记互相冲突，须核对适用变体')
    row['population']=excluded
   elif value not in negative:
    row['quantity']='';row.setdefault('reviewReasons',[]).append('不装件/排除标记不明确，未采用数量')
  if not row.get('sku') and not row.get('name') and not row.get('mpn') and not row.get('designators') and not boxes: continue
  total=lambda v:re.fullmatch(r'(?:单机)?(?:数量)?(?:合计|总计)|(?:SUB)?TOTAL',v,re.I)
  if total(row.get('sku',''))or(not row.get('item')and not row.get('sku')and not row.get('mpn')and total(row.get('name',''))):continue
  if method=='ocr-cells'and not re.search(r'\d',row.get('item',''))and not re.search(r'[A-Za-z0-9]{2}',row.get('sku',''))and not row.get('quantity')and re.match(r'^\s*Fig\.?\s*\d+.*(?:Parts|Plumbing|Control Box)',row.get('name',''),re.I):continue
  row.update({'sourceRow':row_numbers[index] if row_numbers else index+1,'rawCells':cells,'confidence':min(confidences[index],default=100) if confidences else 100})
  if boxes: row['bbox']=boxes[index]
  if method=='ocr-cells'and confidences and 'quantity'in columns.values():
   qi=next(i for i,v in columns.items()if v=='quantity')
   if qi<len(confidences[index])and confidences[index][qi]<85 and row.get('quantity'):
    as_needed=re.sub(r'\s+','',row['quantity']).upper()in ['A/R','AR']
    row['unverifiedQuantity']=row['quantity'];row['quantity']='';row.setdefault('reviewReasons',[]).append('来源为按需用量，保留原文并等待明确用量'if as_needed else'数量字符识别置信不足，保留原始单元格并等待人工填写')
  if method=='ocr-cells': row.setdefault('reviewReasons',[]).append('图片识别结果须对照原图核对件号和用量')
  if table.get('ambiguousColumns'):row.setdefault('reviewReasons',[]).append('表头存在重复含义的列，相关字段未自动采用')
  if not row.get('sku') and not row.get('name') and not row.get('mpn'): row.setdefault('reviewReasons',[]).append('该表格行未读出物料，请核对原图')
  table['rows'].append(row)
 return [t for t in tables if t['rows']]

def grid_tables(image, filename, page=None, words=None, word_size=None, grid_image=None):
 if image.width*image.height>12_000_000 or max(image.size)>10000: raise ValueError('IMAGE_TOO_LARGE')
 tables=[]
 for xs,ys in (line_grids(grid_image)if grid_image is not None else grids(image)):
  # A user crop may retain the bottom headings but cut off their bottom border.
  # Read one bounded edge interval; accept it only if it is an explicit header.
  tail=False
  if len(ys)>2 and 7<image.height-ys[-1]<=max(80,2*sorted(b-a for a,b in zip(ys,ys[1:]))[len(ys)//2-1]):
   ys=[*ys,image.height];tail=True
  rows=[];boxes=[];scores=[];columns=None;numeric_cache={};header_index=None
  for ri,(y0,y1) in enumerate(zip(ys,ys[1:])):
   if y1-y0<7: continue
   cells=[];conf=[]
   for ci,(x0,x1) in enumerate(zip(xs,xs[1:])):
    if words is not None:
     sx,sy=word_size[0]/image.width,word_size[1]/image.height
     selected=[w for w in words if x0*sx<=(w['x']+w['w']/2)<x1*sx and y0*sy<=(w['y']+w['h']/2)<y1*sy]
     value=text_cell(selected);score=100
    else:
     numeric=columns.get(ci)if columns and columns.get(ci)in ['item','quantity','level','wastePercent']else False
     if numeric and header_index is not None and ci in numeric_cache:
      # The same source-row interval is used at both scales; no sequential-number fill.
      value,score=numeric_cache[ci].get(ri-header_index-1,('',0))
      if score<85:
       # Local cell evidence can recover a faint digit missed in the column strip.
       # Quantity still requires two-scale agreement; no confidence threshold is lowered.
       alternate,confidence=ocr_cell(image.crop((x0+3,y0+3,x1-2,y1-2)),numeric)
       if confidence>score:value,score=alternate,confidence
     else:value,score=ocr_cell(image.crop((x0+3,y0+3,x1-2,y1-2)),numeric)
    cells.append(value);conf.append(score)
   rows.append(cells);boxes.append([xs[0],y0,xs[-1],y1]);scores.append(conf)
   fields=header_fields(cells)
   if tail and ri==len(ys)-2 and not parts_header(cells,fields):
    rows.pop();boxes.pop();scores.pop();continue
   if parts_header(cells,fields):
    columns=fields;header_index=ri;numeric_cache={}
    if words is None:
     intervals=list(zip(ys[ri+1:],ys[ri+2:]))
     # Only uniform source rows are batched. Merged scan cells retain token-based splitting.
     heights=[b-a for a,b in intervals]
     if heights and max(heights)<=min(heights)*1.5:
      for ci,f in fields.items():
       if f in ['item','quantity']and list(fields.values()).count(f)==1:
        cached=numeric_column(image,xs[ci],xs[ci+1],intervals,f=='quantity')
        if cached:numeric_cache[ci]=cached
   # Title blocks are grids too. Do not OCR every row of unrelated grids.
   if ri>=3 and not columns and words is None and not(ri<12 and all(r and re.fullmatch(r'\d+',r[0].strip())for r in rows)): break
  if words is None:
   # Rows above bottom headings were read before their types were known. Apply
   # the same two-scale numeric gate used for top-heading quantity columns.
   for hi,cells in enumerate(rows):
    fields=header_fields(cells);ii=next((i for i,f in fields.items()if f=='item'),None)
    if hi and parts_header(cells,fields)and ii is not None and all(ii<len(r)and re.fullmatch(r'\d+',r[ii].strip())for r in rows[:hi]):
     for ci,f in fields.items():
      if f!='quantity' or list(fields.values()).count(f)>1:continue
      intervals=[(box[1],box[3])for box in boxes[:hi]]
      cached=numeric_column(image,xs[ci],xs[ci+1],intervals,True)
      for ri,(y0,y1)in enumerate(intervals):
       value,score=cached.get(ri,('',0))
       if not cached:value,score=ocr_cell(image.crop((xs[ci]+3,y0+3,xs[ci+1]-2,y1-2)),'quantity')
       rows[ri][ci]=value;scores[ri][ci]=score
     break
   # Numeric-only OCR can erase a printed PCS/MM suffix or A/R. On weak quantity
   # cells, preserve a separately observed full literal; require two-scale
   # agreement before adopting a number with a unit. No drawing-wide unit fill.
   active=None
   for cells in rows:
    fields=header_fields(cells)
    if parts_header(cells,fields):active=fields;break
   if active:
    for ci,f in active.items():
     if f!='quantity' or list(active.values()).count(f)>1:continue
     for ri,(cells,box)in enumerate(zip(rows,boxes)):
      if parts_header(cells,header_fields(cells))or scores[ri][ci]>=85:continue
      literal,score=ocr_cell(image.crop((xs[ci]+3,box[1]+3,xs[ci+1]-2,box[3]-2)),'quantity-literal')
      compact=re.sub(r'\s+','',literal).upper()
      if re.fullmatch(r'\d+(?:\.\d+)?(?:PCS|PC|EA|MM|CM|KG|G|M)',compact)or compact in ['A/R','AR']:
       cells[ci]=literal;scores[ri][ci]=score if compact not in ['A/R','AR']else 0
   rows,boxes,scores=split_grid_rows(image,xs,rows,boxes,scores)
  parsed=parse_rows(rows,filename,page=page,method='pdf-cells' if words is not None else 'ocr-cells',boxes=boxes,confidences=scores)
  # Multi-tier quantity headers spanning subcolumns denote unresolved variants.
  # Incomplete headers must not silently pick a model's first numeric column.
  for t in parsed:
   if any('quantity'==field(c)and i<len(xs)-2 and not cells[i+1].strip()and not any(field(v)=='quantity'for v in cells[i+1:])and any(re.search(r'\d',str(r[i+1]))for r in rows[1:3]if i+1<len(r))for cells in rows[:2]for i,c in enumerate(cells)):
    for row in t['rows']:
     row['quantity']='';row.setdefault('reviewReasons',[]).append('多级数量表头含多个适用型号，未选择变体前不采用数量')

  for table in parsed:
   table['table']=len(tables)+1;table['pageSize']=[image.width,image.height];tables.append(table)
 return tables

def split_grid_rows(image,xs,rows,boxes,scores):
 columns=None;out=[];locations=[];confidences=[]
 heights=sorted(b[3]-b[1]for b in boxes);typical=heights[len(heights)//2]if heights else 0
 for cells,box,score in zip(rows,boxes,scores):
  fields=header_fields(cells)
  if parts_header(cells,fields):columns=fields
  anchor_column=next((i for i,f in (columns or {}).items()if f=='item'),None)
  if anchor_column is None and columns and 0 not in columns and columns.get(1)=='sku':anchor_column=0
  # A scan's physical grid cell can contain several printed BOM rows. Its height
  # need not exceed the median: a whole page may consist of merged cells. Probe
  # existing multi-value cells, then require separate visible numeric anchors.
  # This never generates sequential item numbers or splits on a wrapped name.
  sku_column=next((i for i,f in (columns or {}).items()if f=='sku'),None)
  multi_sku=sku_column is not None and len(re.findall(r'(?<![\w/-])[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)+(?![\w/-])',cells[sku_column]))>1
  multi_item=anchor_column is not None and len(re.findall(r'\b\d{1,6}\b',cells[anchor_column]))>1
  if columns and anchor_column is not None and not is_header(fields)and(columns.get(anchor_column)!='item'or box[3]-box[1]>typical*1.5 or multi_sku or multi_item):
   ci=anchor_column;x0,x1=xs[ci],xs[ci+1];y0,y1=box[1],box[3]
   # Bounded OCR finds item baselines; only explicit numeric anchors split rows.
   crop=image.crop((x0+4,y0+3,x1-3,y1-2));_,_,tokens=ocr_cell(crop,details=True)
   # The bilingual and Latin recognizers miss different printed digits. Only
   # their observed numeric baselines are combined, never fabricated numbers.
   _,_,latin_tokens=ocr_cell(crop,details=True,latin=True)
   lines=[]
   for t in sorted(tokens+latin_tokens,key=lambda t:t['y']):
    if not re.fullmatch(r'\d{1,6}',t['text']):continue
    if not lines or abs(t['y']-lines[-1]['y'])>max(2,t['h']*.5):lines.append(t)
    elif t['conf']>lines[-1]['conf']:lines[-1]=t
   if len(lines)>1:
    # ocr_cell scales and adds a 12px border. Map relative baseline spacing.
    padded_height=crop.height+24;scale=min(4,max(2,round(100/padded_height)))if padded_height<80 else 1
    anchors=[y0+3+(t['y']-12*scale)/scale for t in lines]
    boundaries=[y0]+[round(a-3)for a in anchors[1:]]+[y1]
    token_columns=[]
    for ci,(left,right) in enumerate(zip(xs,xs[1:])):
     _,_,ts=ocr_cell(image.crop((left+3,y0+3,right-2,y1-2)),details=True,latin=ci==anchor_column)
     token_columns.append([{**t,'y':y0+3+(t['y']-12*scale)/scale,'h':t['h']/scale}for t in ts])
    for top,bottom in zip(boundaries,boundaries[1:]):
     if bottom-top<7:continue
     values=[];cs=[]
     for ci,ts in enumerate(token_columns):
      selected=[t for t in ts if top<=t['y']+t['h']/2<bottom]
      if ci==anchor_column:selected=[t for t in lines if top<=y0+3+(t['y']-12*scale)/scale+t['h']/scale/2<bottom]
      values.append(text_cell(selected));cs.append(min([t['conf']for t in selected],default=0))
      # Split-cell quantity OCR has not undergone the two-scale quantity check.
      # Keep it as an unverified candidate, with the source cells preserved.
      if columns.get(ci)=='quantity':cs[-1]=0
     out.append(values);locations.append([xs[0],top,xs[-1],bottom]);confidences.append(cs)
    continue
  out.append(cells);locations.append(box);confidences.append(score)
 return out,locations,confidences

def white_image(image):
 # Transparent PNG backgrounds must be white, never silently rendered black.
 rgba=image.convert('RGBA')
 background=Image.new('RGBA',rgba.size,'white');background.alpha_composite(rgba)
 return background.convert('RGB')

def raster_view(image):
 import cv2, numpy as np
 cv2.setNumThreads(1)
 gray=np.asarray(image.convert('L'))
 # Detect the paper boundary only if it is a large, convex quadrilateral.
 # All transformations map boxes back to the uploaded/original page below.
 scale=min(1,1400/max(image.size));small=cv2.resize(gray,None,fx=scale,fy=scale)
 _,paper=cv2.threshold(small,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
 contours,_=cv2.findContours(paper,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
 matrix=np.eye(3);working=np.asarray(image)
 for c in sorted(contours,key=cv2.contourArea,reverse=True)[:4]:
  if cv2.contourArea(c)<small.size*.55:continue
  poly=cv2.approxPolyDP(c,cv2.arcLength(c,True)*.015,True)
  if len(poly)!=4 or not cv2.isContourConvex(poly):continue
  pts=poly.reshape(4,2).astype('float32')/scale
  # Ignore a paper edge identical to the image boundary (ordinary scans).
  sums=pts.sum(axis=1);diff=np.diff(pts,axis=1).ravel()
  ordered=np.array([pts[np.argmin(sums)],pts[np.argmin(diff)],pts[np.argmax(sums)],pts[np.argmax(diff)]],dtype='float32')
  if len(set(map(tuple,ordered)))!=4:continue
  if min(ordered[:,0])<3 and min(ordered[:,1])<3 and max(ordered[:,0])>image.width-4 and max(ordered[:,1])>image.height-4:break
  w=round(max(np.linalg.norm(ordered[1]-ordered[0]),np.linalg.norm(ordered[2]-ordered[3])))
  h=round(max(np.linalg.norm(ordered[3]-ordered[0]),np.linalg.norm(ordered[2]-ordered[1])))
  if w<100 or h<100 or w*h>12_000_000:continue
  matrix=cv2.getPerspectiveTransform(ordered,np.float32([[0,0],[w-1,0],[w-1,h-1],[0,h-1]]))
  working=cv2.warpPerspective(working,matrix,(w,h),borderValue=(255,255,255));break
 gray=cv2.cvtColor(working,cv2.COLOR_RGB2GRAY)
 edge_scale=min(1,1200/max(gray.shape))
 edge_gray=cv2.resize(gray,None,fx=edge_scale,fy=edge_scale)
 edges=cv2.Canny(edge_gray,60,180)
 lines=cv2.HoughLinesP(edges,1,np.pi/1800,threshold=80,minLineLength=max(80,max(edge_gray.shape)*.12),maxLineGap=15)
 angles=[]
 if lines is not None:
  for (x1,y1,x2,y2) in lines[:,0]:
   angle=np.degrees(np.arctan2(y2-y1,x2-x1));angle=(angle+45)%90-45
   if abs(angle)<=8:angles.append(angle)
 angle=float(np.median(angles))if len(angles)>=3 else 0
 if .15<abs(angle)<=8:
  h,w=gray.shape;aff=cv2.getRotationMatrix2D((w/2,h/2),angle,1)
  rotation=np.vstack([aff,[0,0,1]]);matrix=rotation@matrix
  working=cv2.warpAffine(working,aff,(w,h),borderValue=(255,255,255))
 # Normalize illumination for line detection and cell OCR. Do not sharpen text
 # into guessed characters or use a language model to invent unreadable cells.
 gray=cv2.cvtColor(working,cv2.COLOR_RGB2GRAY)
 binary=cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY,31,13)
 return Image.fromarray(working),Image.fromarray(binary).convert('RGB'),matrix

def image_tables(image, filename, page=None, words=None, word_size=None):
 if image.width*image.height>12_000_000 or max(image.size)>10000:raise ValueError('IMAGE_TOO_LARGE')
 image=white_image(image)
 if words is not None:return grid_tables(image,filename,page,words,word_size)
 import cv2,numpy as np
 original_size=image.size
 working,binary,matrix=raster_view(image)
 # A quarter-turn is a distinct candidate, never an automatic row merge.
 # Try at most four orientations and stop at the first recognized BOM header.
 for turn in [0,1,3,2]:
  a=np.rot90(np.asarray(working),turn).copy();bw=np.rot90(np.asarray(binary),turn).copy()
  h,w=working.height,working.width
  rotation=[np.eye(3),np.array([[0,1,0],[-1,0,w-1],[0,0,1]]),np.array([[-1,0,w-1],[0,-1,h-1],[0,0,1]]),np.array([[0,-1,h-1],[1,0,0],[0,0,1]])][turn]
  # Use normalized line geometry; OCR the continuous-tone original cells.
  tables=grid_tables(Image.fromarray(a),filename,page,grid_image=Image.fromarray(bw))
  if not tables:continue
  inverse=np.linalg.inv(rotation@matrix)
  for table in tables:
   table['pageSize']=list(original_size)
   for row in table['rows']:
    x0,y0,x1,y1=row['bbox'];corners=np.float32([[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]])
    points=cv2.perspectiveTransform(corners,inverse)[0]
    row['bbox']=[max(0,float(points[:,0].min())),max(0,float(points[:,1].min())),min(original_size[0],float(points[:,0].max())),min(original_size[1],float(points[:,1].max()))]
    row.setdefault('reviewReasons',[]).append('扫描或照片可能存在漏行和字符混淆，须核对明细总行数及本行件号和用量')
  return tables
 return []

def xml(archive,name):
 content=archive.read(name)
 if b'<!DOCTYPE' in content.upper() or b'<!ENTITY' in content.upper(): raise ValueError('DOCUMENT_INVALID')
 return ET.fromstring(content)

def office(raw, filename, diagnostics=None):
 archive=zipfile.ZipFile(io.BytesIO(raw));entries=archive.infolist()
 if len(entries)>2048 or sum(e.file_size for e in entries)>32*1024*1024: raise ValueError('DOCUMENT_TOO_LARGE')
 if any(e.flag_bits&1 or e.file_size>8*1024*1024 or e.file_size>max(e.compress_size,1)*1000 for e in entries): raise ValueError('DOCUMENT_TOO_LARGE')
 ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 shared=[]
 if 'xl/sharedStrings.xml' in archive.namelist(): shared=[''.join(t.text or '' for t in si.findall('.//s:t',ns)) for si in xml(archive,'xl/sharedStrings.xml').findall('s:si',ns)]
 rels={r.attrib['Id']:r.attrib['Target'] for r in xml(archive,'xl/_rels/workbook.xml.rels') if r.attrib.get('TargetMode')!='External'}
 formats={};styles=[]
 if 'xl/styles.xml' in archive.namelist():
  style_xml=xml(archive,'xl/styles.xml')
  formats={x.attrib['numFmtId']:x.attrib.get('formatCode','') for x in style_xml.findall('s:numFmts/s:numFmt',ns)}
  styles=[formats.get(x.attrib.get('numFmtId',''),'') for x in style_xml.findall('s:cellXfs/s:xf',ns)]
 tables=[];count=0
 for sheet in xml(archive,'xl/workbook.xml').findall('s:sheets/s:sheet',ns):
  target=rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
  target=posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/'+target)
  if not target.startswith('xl/'): raise ValueError('DOCUMENT_INVALID')
  rows=[];row_numbers=[];formula_rows=set();sheet_xml=xml(archive,target)
  for row in sheet_xml.findall('s:sheetData/s:row',ns):
   row_numbers.append(int(row.attrib.get('r','0')))
   values=[]
   for cell in row.findall('s:c',ns):
    count+=1
    if count>20000: raise ValueError('DOCUMENT_TOO_LARGE')
    ref=re.match(r'^([A-Z]+)[0-9]+$',cell.attrib.get('r',''))
    if not ref: raise ValueError('DOCUMENT_INVALID')
    col=0
    for c in ref[1]: col=col*26+ord(c)-64
    if col>64: raise ValueError('DOCUMENT_TOO_LARGE')
    values.extend(['']*max(0,col-len(values)))
    value=cell.findtext('s:v',default='',namespaces=ns);kind=cell.attrib.get('t')
    if cell.find('s:f',ns) is not None:
     value='';formula_rows.add(row_numbers[-1]) # Never trust stale formula caches.
    elif kind=='s': value=shared[int(value)]
    elif kind=='inlineStr': value=''.join(t.text or '' for t in cell.findall('.//s:t',ns))
    elif kind in [None,'n'] and value:
     number=Decimal(value)
     if not number.is_finite() or abs(number.as_tuple().exponent)>30:raise ValueError('DOCUMENT_INVALID')
     value=format(number,'f')
     style=int(cell.attrib.get('s','0'))
     mask=styles[style] if style<len(styles) else ''
     if re.fullmatch(r'0{2,20}',mask) and re.fullmatch(r'\d+',value):value=value.zfill(len(mask))
    values[col-1]=value
   rows.append(values)
  # Only an explicitly merged parent cell supplies parent identity to its covered rows.
  parent_columns={i for cells in rows for i,v in enumerate(cells) if field(v)=='parent'}
  row_map={n:cells for n,cells in zip(row_numbers,rows)}
  for merged in sheet_xml.findall('s:mergeCells/s:mergeCell',ns):
   match=re.fullmatch(r'([A-Z]+)(\d+):([A-Z]+)(\d+)',merged.attrib.get('ref',''))
   if not match or match[1]!=match[3]:continue
   col=0
   for c in match[1]:col=col*26+ord(c)-64
   col-=1;first,last=int(match[2]),int(match[4])
   if col not in parent_columns or last-first>500:continue
   origin=row_map.get(first,[]);value=origin[col] if col<len(origin) else ''
   for n,cells in row_map.items():
    if first<n<=last:
     cells.extend(['']*max(0,col+1-len(cells)))
     if not cells[col]:cells[col]=value
  parsed=parse_rows(rows,filename,sheet=sheet.attrib.get('name',''),method='xlsx-cells',row_numbers=row_numbers)
  if diagnostics is not None and not parsed and len(rows)>1 and any(any(c.strip()for c in row)for row in rows):diagnostics.append(sheet.attrib.get('name',''))
  for t in parsed:
   for r in t['rows']:
    if r['sourceRow']in formula_rows:r.setdefault('reviewReasons',[]).append('该行包含公式；公式单元格未采用，请确认实际值')
  tables+=parsed
 return tables

def main():
 if sys.platform.startswith('linux'):
  import resource
  resource.setrlimit(resource.RLIMIT_AS,(768*1024*1024,768*1024*1024))
  resource.setrlimit(resource.RLIMIT_CPU,(110,110))
 request=json.loads(sys.stdin.buffer.read(12*1024*1024+1));tables=[];sources=[];total_pages=0
 files=request.get('documents',[])
 if request.get('text','').strip(): files=[{'filename':'粘贴资料.tsv','data':base64.b64encode(request['text'].encode()).decode()},*files]
 for document in files:
  filename=document['filename'];raw=base64.b64decode(document['data'],validate=True);ext=filename.rsplit('.',1)[-1].lower()
  before=len(tables)
  sources.append({'filename':filename,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
  if ext in ['csv','tsv','txt']:
   if raw.startswith((b'\xff\xfe',b'\xfe\xff')):text=raw.decode('utf-16')
   else:
    try:text=raw.decode('utf-8-sig')
    except UnicodeDecodeError:text=raw.decode('gb18030')
   if '\x00' in text:raise ValueError('DOCUMENT_INVALID')
   try: dialect=csv.Sniffer().sniff(text[:8192],delimiters=',\t;|')
   except csv.Error: dialect=csv.excel_tab
   rows=list(csv.reader(io.StringIO(text),dialect))
   if len(rows)>500 or any(len(row)>64 for row in rows):raise ValueError('DOCUMENT_TOO_LARGE')
   tables+=parse_rows(rows,filename,method='text-cells')
  elif ext=='xlsx':
   unmapped=[];tables+=office(raw,filename,unmapped)
   if unmapped:sources[-1]['unmappedSheets']=unmapped
  elif ext=='xls':
   sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'knowledge'))
   from legacy_excel import read_xls
   for sheet in read_xls(raw):
    rows=sheet['rows'];parent_columns={i for cells in rows for i,v in enumerate(cells)if field(v)=='parent'}
    for first,last,col,end_col in sheet['merged']:
     if col not in parent_columns or end_col!=col+1:continue
     for ri in range(first+1,last):
      if not rows[ri][col]:rows[ri][col]=rows[first][col]
    parsed=parse_rows(rows,filename,sheet=sheet['name'],method='xls-cells')
    for table in parsed:
     for row in table['rows']:
      if any(ri==row['sourceRow']-1 for ri,ci in sheet['formulaCells']):row.setdefault('reviewReasons',[]).append('该行包含公式；公式单元格未采用，请确认实际值')
    tables+=parsed
  elif ext=='pcbdoc':
   sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'knowledge'))
   from pcb_native import read_pcb
   inventory=read_pcb(raw)
   rows=[]
   for obj in inventory['components']:
    refs=obj['designator'];name=' · '.join(x for x in [refs or 'PCB对象'+str(obj['index']+1),obj['modelHint']or obj['comment'],obj['footprint']]if x)
    rows.append({'sku':'','name':name,'mpn':obj['mpn'],'manufacturer':obj['manufacturer'],'designators':refs,'quantity':'1'if obj['sourceUniqueId']else'','unit':'piece','population':'YES'if obj['population']=='TRUE'else'DNI'if obj['population']=='FALSE'else'UNKNOWN','sourceRow':obj['index']+1,'rawCells':[refs,obj['sourceDesignator'],obj['modelHint'],obj['footprint'],obj['sourceUniqueId'],'PCB对象数=1','装配状态='+obj['population']],'confidence':100,'sourceObjectId':obj['objectId']or str(obj['index']),'sourceDesignator':obj['sourceDesignator'],'sourceUniqueId':obj['sourceUniqueId'],'sourceHierarchy':obj['hierarchy'],'footprint':obj['footprint'],'quantityBasis':'pcb-object-count','reviewReasons':obj['warnings']+['当前数量依据为板上单个器件对象，必须核对适用装配状态后采用']})
   if rows:tables.append({'file':filename,'table':1,'method':'altium-pcb6','verification':'layout-inventory-only','warnings':inventory['warnings'],'counts':inventory['counts'],'rows':rows})
  elif ext=='pdf':
   if not raw.startswith(b'%PDF-'):raise ValueError('DOCUMENT_INVALID')
   with tempfile.TemporaryDirectory(prefix='suite-bom-') as directory:
    pdf=Path(directory)/'input.pdf';pdf.write_bytes(raw)
    bbox=run([os.environ.get('KNOWLEDGE_PDFTOTEXT_PATH','pdftotext'),'-bbox-layout','-enc','UTF-8',str(pdf),'-'])
    pages=ET.fromstring(bbox).findall('.//{*}page');total_pages+=len(pages)
    if total_pages>24:raise ValueError('DOCUMENT_PAGE_LIMIT')
    for n,page in enumerate(pages,1):
     words=[]
     for w in page.findall('.//{*}word'):
      words.append({'text':w.text or '', 'x':float(w.attrib['xMin']),'y':float(w.attrib['yMin']),'w':float(w.attrib['xMax'])-float(w.attrib['xMin']),'h':float(w.attrib['yMax'])-float(w.attrib['yMin'])})
     prefix=str(Path(directory)/'page')
     run([os.environ.get('KNOWLEDGE_PDFTOPPM_PATH','pdftoppm'),'-f',str(n),'-l',str(n),'-singlefile','-scale-to','3000','-png',str(pdf),prefix])
     with Image.open(prefix+'.png') as image:
      pw,ph=float(page.attrib['width']),float(page.attrib['height'])
      # Poppler bbox attributes can retain MediaBox orientation on /Rotate=90 PDFs.
      if abs(pw/ph-image.width/image.height)>abs(ph/pw-image.width/image.height): pw,ph=ph,pw
      page_tables=image_tables(image,filename,page=n,words=words if words else None,word_size=(pw,ph))
      # A scanned table may coexist with a selectable footer. Retry this page's grids via OCR.
      if words and not page_tables:page_tables=image_tables(image,filename,page=n)
      tables+=page_tables
     os.unlink(prefix+'.png')
  elif ext in ['png','jpg','jpeg']:
   # Camera JPEGs may carry an MPO secondary image/gain map. Read frame zero
   # only, with the same pixel limit; never merge secondary images as BOM rows.
   with warnings.catch_warnings():
    warnings.simplefilter('ignore',Image.DecompressionBombWarning)
    with Image.open(io.BytesIO(raw)) as original:
     if original.width*original.height>12_000_000:raise ValueError('IMAGE_TOO_LARGE')
     if original.format not in ['PNG','JPEG','MPO']:raise ValueError('DOCUMENT_INVALID')
     if original.format=='MPO':original.seek(0)
     image=ImageOps.exif_transpose(original)
     tables+=image_tables(image,filename)
  else:raise ValueError('DOCUMENT_FORMAT_UNSUPPORTED')
  for table in tables[before:]:
   table['sourceSha256']=hashlib.sha256(raw).hexdigest()
   table['productCode']=document.get('productCode','')
   table['revision']=document.get('revision','')
  sources[-1]['tableCount']=len(tables)-before
  sources[-1]['parseState']='table-detected'if len(tables)>before else'review-required'
  if sources[-1].get('unmappedSheets')and len(tables)>before:
   sources[-1]['parseState']='partial-review-required';sources[-1]['warning']='以下工作表未确认物料表，请核对表头或手工整理：'+'、'.join(sources[-1]['unmappedSheets'])
  if len(tables)==before:sources[-1]['warning']='未确认可用物料表：可能缺少明细、表头尚未映射或文字不可读，请核对原件，不代表没有零件'
  if sum(len(t['rows']) for t in tables)>300:raise ValueError('DOCUMENT_ROW_LIMIT')
 print(json.dumps({'tables':tables,'sources':sources,'pageCount':total_pages},ensure_ascii=False))

if __name__=='__main__':
 try:main()
 except Image.DecompressionBombError:
  print('IMAGE_TOO_LARGE',file=sys.stderr);sys.exit(1)
 except Exception as error:
  code=str(error) if str(error) in ['DOCUMENT_TOO_LARGE','DOCUMENT_INVALID','DOCUMENT_TIMEOUT','DOCUMENT_PROCESS_FAILED','DOCUMENT_PAGE_LIMIT','DOCUMENT_ROW_LIMIT','IMAGE_TOO_LARGE','DOCUMENT_FORMAT_UNSUPPORTED'] else 'DOCUMENT_INVALID'
  print(code,file=sys.stderr);sys.exit(1)
