"""Bounded page preparation. Native cells first; no OCR or model dispatch here."""
import base64, hashlib, importlib.util, io, json, os, sys, tempfile
from pathlib import Path
from xml.etree import ElementTree as ET
from PIL import Image, ImageOps

spec=importlib.util.spec_from_file_location('bom',Path(__file__).with_name('bom-document-parser.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

def main():
 if sys.platform.startswith('linux'):
  import resource
  resource.setrlimit(resource.RLIMIT_AS,(768*1024*1024,768*1024*1024))
  resource.setrlimit(resource.RLIMIT_CPU,(40,40))
 r=json.loads(sys.stdin.buffer.read(12*1024*1024+1));d=r['document'];raw=base64.b64decode(d['data'],validate=True)
 if not 0<len(raw)<=8*1024*1024:raise ValueError('DOCUMENT_TOO_LARGE')
 ext=d['filename'].rsplit('.',1)[-1].lower()
 if ext not in ['pdf','png','jpg','jpeg']:
  if r['mode']!='plan':raise ValueError('DOCUMENT_INVALID')
  print(json.dumps({'pages':1,'structured':True}));return
 with tempfile.TemporaryDirectory(prefix='suite-bom-vision-')as td:
  native=[];words=[];rotated=False
  if ext=='pdf':
   if not raw.startswith(b'%PDF-'):raise ValueError('DOCUMENT_INVALID')
   f=Path(td)/'source.pdf';f.write_bytes(raw)
   args=['-bbox-layout','-enc','UTF-8']
   if r['mode']!='plan':args+=['-f',str(r['page']),'-l',str(r['page'])]
   pages=ET.fromstring(b.run([os.environ.get('KNOWLEDGE_PDFTOTEXT_PATH','pdftotext'),*args,str(f),'-'],timeout=20)).findall('.//{*}page')
   if not 1<=len(pages)<=24:raise ValueError('DOCUMENT_PAGE_LIMIT')
   if r['mode']=='plan':print(json.dumps({'pages':len(pages),'structured':False}));return
   page=pages[0]
   for w in page.findall('.//{*}word'):words.append({'text':w.text or'','x':float(w.attrib['xMin']),'y':float(w.attrib['yMin']),'w':float(w.attrib['xMax'])-float(w.attrib['xMin']),'h':float(w.attrib['yMax'])-float(w.attrib['yMin'])})
   prefix=str(Path(td)/'page')
   b.run([os.environ.get('KNOWLEDGE_PDFTOPPM_PATH','pdftoppm'),'-f',str(r['page']),'-l',str(r['page']),'-singlefile','-scale-to','3000','-png',str(f),prefix],timeout=20)
   image=b.Image.open(prefix+'.png').convert('RGB')
   pw,ph=float(page.attrib['width']),float(page.attrib['height'])
   if abs(pw/ph-image.width/image.height)>abs(ph/pw-image.width/image.height):pw,ph=ph,pw;rotated=True
   if words:native=b.image_tables(image,d['filename'],page=r['page'],words=words,word_size=(pw,ph))
  else:
   with Image.open(io.BytesIO(raw))as original:
    if original.format not in ['PNG','JPEG','MPO']or original.width*original.height>12_000_000 or max(original.size)>10000:raise ValueError('IMAGE_TOO_LARGE')
    if r['mode']=='plan':print(json.dumps({'pages':1,'structured':False}));return
    original.seek(0);image=b.white_image(ImageOps.exif_transpose(original))
   image.thumbnail((3000,3000),Image.Resampling.LANCZOS)
  import numpy as np
  arr=np.asarray(image.convert('L'))
  geometric=b.grids(image)
  dense=any(len(ys)>45 for xs,ys in geometric)
  # Geometric risk chooses a tested model; no fabricated detail or model boxes.
  try:
   _,_,matrix=b.raster_view(image);distorted=not np.allclose(matrix,np.eye(3),atol=.05)
  except Exception:distorted=True
  text=''.join(w['text']for w in words).lower()
  parts_header=any(s in text for s in ['billofmaterials','partslist','物料清单','明细表'])
  rows=[row for table in native for row in table['rows']]
  safe=bool(rows)and not any(t.get('ambiguousColumns')for t in native)and all(row.get('sku')or row.get('name')or row.get('mpn')for row in rows)and '\ufffd'not in text
  out=io.BytesIO();image.save(out,format='PNG');png=out.getvalue()
  if len(png)>8*1024*1024:raise ValueError('DOCUMENT_TOO_LARGE')
  print(json.dumps({'mime':'image/png','data':base64.b64encode(png).decode(),'sha256':hashlib.sha256(png).hexdigest(),'width':image.width,'height':image.height,'nativeTables':native if safe else[],'risk':{'dense':dense,'distorted':distorted or rotated,'lowContrast':float(arr.std())<22},'hasPartsHeader':parts_header,'preprocessVersion':'bom-page-1'},ensure_ascii=False))
if __name__=='__main__':
 try:main()
 except Exception as e:
  message=str(e);print(message if message in ['DOCUMENT_TOO_LARGE','DOCUMENT_PAGE_LIMIT','IMAGE_TOO_LARGE','DOCUMENT_TIMEOUT']else'BOM_PAGE_PREPARATION_FAILED',file=sys.stderr);sys.exit(1)
