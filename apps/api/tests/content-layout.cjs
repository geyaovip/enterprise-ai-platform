const { spawnSync } = require("node:child_process");
const result = spawnSync(
  "python3",
  [
    "-c",
    `
import subprocess,base64,json,io,zipfile,hashlib,os
from PIL import Image
checks=0
def check(x):
 global checks
 assert x
 checks+=1
script='src/modules/content/content-media.py'
def op(v,success=True):
 p=subprocess.run(['python3',script],input=json.dumps(v),text=True,capture_output=True)
 check((p.returncode==0)==success)
 return json.loads(p.stdout) if success else None
art={'width':1080,'height':1080,'backgroundColor':'#ffffff','layers':[{'id':'title','type':'text','text':'自然随行 / Sample ¥279','x':.1,'y':.2,'w':.8,'h':.2,'fontSize':54,'color':'#52624d'}],'copy':{'title':'自然随行','body':'','cta':''}}
layout=op({'op':'layout','data':art});check(not layout['issues']);check(layout['version']=='content-noto-sc-v1')
patch=Image.open(io.BytesIO(base64.b64decode(layout['layers'][0]['image'].split(',')[1]))).convert('RGBA')
output=op({'op':'export','items':[{'data':art,'version':1}],'assets':{},'manifest':{},'format':'transparent','draft':False})
z=zipfile.ZipFile(io.BytesIO(base64.b64decode(output['data'])));im=Image.open(io.BytesIO(z.read([s for s in z.namelist() if s.endswith('.png')][0]))).convert('RGBA')
check(im.crop((108,216,972,432)).tobytes()==patch.tobytes())
long=json.loads(json.dumps(art));long['layers'][0]['text']='长标题与English参数 '.join(['内容']*200)
check(op({'op':'layout','data':long})['issues'][0]['code']=='text_overflow')
op({'op':'export','items':[{'data':long,'version':1}],'assets':{},'manifest':{},'format':'png','draft':False},False)
outside=json.loads(json.dumps(art));outside['layers'][0]['x']=.8
check(any(x['code']=='outside' for x in op({'op':'layout','data':outside})['issues']))
source=Image.new('RGBA',(100,100),'red');source.paste('blue',(50,0,100,100));b=io.BytesIO();source.save(b,format='PNG')
image=json.loads(json.dumps(art));image['layers']=[{'id':'product','type':'image','assetId':'sample','x':.1,'y':.1,'w':.8,'h':.8,'crop':{'x':.5,'y':0,'w':.5,'h':1}}]
output=op({'op':'export','items':[{'data':image,'version':1}],'assets':{'sample':base64.b64encode(b.getvalue()).decode()},'manifest':{},'format':'transparent','draft':False})
z=zipfile.ZipFile(io.BytesIO(base64.b64decode(output['data'])));im=Image.open(io.BytesIO(z.read([s for s in z.namelist() if s.endswith('.png')][0]))).convert('RGBA')
check(im.getpixel((540,540))==(0,0,255,255));check(im.getpixel((108,540))[3]==0)
thumb=op({'op':'thumbnail','data':base64.b64encode(b.getvalue()).decode()});check(Image.open(io.BytesIO(base64.b64decode(thumb['data']))).size==(100,100))
print(json.dumps({'ok':True,'checks':checks,'paidCalls':0,'previewExportTextPixelsEqual':True,'cropAspectPreserved':True}))
`,
  ],
  { cwd: __dirname + "/..", encoding: "utf8" },
);
if (result.status) {
  console.error(result.stderr);
  process.exitCode = 1;
} else console.log(result.stdout.trim());
