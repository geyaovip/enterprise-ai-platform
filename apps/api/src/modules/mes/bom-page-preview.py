"""Render one user-supplied PDF page for review. No OCR, persistence or model calls."""
import base64, hashlib, io, json, os, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

def main():
 if sys.platform.startswith('linux'):
  import resource
  resource.setrlimit(resource.RLIMIT_AS,(768*1024*1024,768*1024*1024))
  resource.setrlimit(resource.RLIMIT_CPU,(15,15))
 r=json.loads(sys.stdin.buffer.read(12*1024*1024+1));raw=base64.b64decode(r['document']['data'],validate=True);page=r['page']
 if not raw.startswith(b'%PDF-')or not 1<=page<=24 or len(raw)>8*1024*1024:raise ValueError('DOCUMENT_INVALID')
 with tempfile.TemporaryDirectory(prefix='suite-bom-preview-')as directory:
  p=Path(directory)/'input.pdf';p.write_bytes(raw);prefix=str(Path(directory)/'page')
  subprocess.run([os.environ.get('KNOWLEDGE_PDFTOPPM_PATH','pdftoppm'),'-f',str(page),'-l',str(page),'-singlefile','-scale-to','3000','-png',str(p),prefix],check=True,timeout=18,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  png=Path(prefix+'.png').read_bytes()
  if len(png)>8*1024*1024:raise ValueError('DOCUMENT_TOO_LARGE')
  with Image.open(io.BytesIO(png))as image:width,height=image.size
 print(json.dumps({'filename':r['document']['filename'],'sha256':hashlib.sha256(raw).hexdigest(),'page':page,'width':width,'height':height,'mime':'image/png','data':base64.b64encode(png).decode()}))
if __name__=='__main__':
 try:main()
 except Exception:print('DOCUMENT_PREVIEW_FAILED',file=sys.stderr);sys.exit(1)
