const { spawnSync } = require("node:child_process"),
  assert = require("node:assert/strict");
const r = spawnSync(
  "python3",
  [
    "-c",
    `
import subprocess,base64,json,io,zipfile
from PIL import Image
checks=0
def check(value,message=''):
 global checks
 assert value,message
 checks+=1
script='src/modules/content/content-media.py'
def image(color):
 b=io.BytesIO();Image.new('RGBA',(120,160),color).save(b,format='PNG');return base64.b64encode(b.getvalue()).decode()
def op(v):
 p=subprocess.run(['python3',script],input=json.dumps(v),text=True,capture_output=True);check(p.returncode==0,p.stderr);return json.loads(p.stdout)
red,blue=image('red'),image('blue')
v=op({'op':'composite','original':red,'generated':blue,'region':{'x':.25,'y':.25,'w':.5,'h':.5}})
im=Image.open(io.BytesIO(base64.b64decode(v['data'])));check(im.getpixel((0,0))==(255,0,0,255));check(im.getpixel((60,80))==(0,0,255,255));check(im.getpixel((119,159))==(255,0,0,255))
v=op({'op':'fit','data':red,'width':1080,'height':1440});check((v['width'],v['height'])==(1080,1440))
art={'width':1080,'height':1080,'backgroundColor':'#ffffff','layers':[{'type':'text','text':'价格299元','x':.1,'y':.1,'w':.8,'h':.1,'fontSize':36,'color':'#000000'}],'copy':{'title':'测试产品','body':'299元','cta':'了解更多'}}
for fmt in ['png','jpeg','transparent']:
 v=op({'op':'export','items':[{'version':1,'data':art}],'assets':{},'format':fmt,'draft':True,'manifest':{'status':'draft'}})
 raw=base64.b64decode(v['data']);z=zipfile.ZipFile(io.BytesIO(raw));names=z.namelist();check(len(names)==4)
 target=[n for n in names if n.endswith(('.png','.jpg'))][0];im=Image.open(io.BytesIO(z.read(target)));check(im.size==(1080,1080))
 if fmt=='transparent':check(im.getpixel((1079,1079))[3]==0)
 extracted=op({'op':'extract','data':v['data'],'index':0});check(base64.b64decode(extracted['data'])==z.read(target))
print(json.dumps({'ok':True,'checks':checks,'paidCalls':0,'formats':['PNG','JPEG','transparent PNG'],'outsideMaskUnchanged':True}))
`,
  ],
  { cwd: __dirname + "/..", encoding: "utf8" },
);
if (r.status) {
  console.error(r.stderr);
  process.exitCode = 1;
} else console.log(r.stdout.trim());
