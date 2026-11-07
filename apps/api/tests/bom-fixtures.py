# -*- coding: utf-8 -*-
"""Generated controls, explicitly distinct from the downloaded public drawings."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import io, sys, zipfile
root=Path(sys.argv[1]);public=Path(sys.argv[2]);root.mkdir(parents=True,exist_ok=True)
img=Image.open(public/'jackscrew-p1-2000.png').convert('RGB')
img.save(root/'scanned.pdf',resolution=150)
other=Image.open(public/'drawer-p1-2000.png').convert('RGB')
img.save(root/'multipage-scan.pdf',save_all=True,append_images=[other],resolution=150)
font=ImageFont.truetype(sys.argv[3],30)
im=Image.new('RGB',(1600,400),'white');draw=ImageDraw.Draw(im)
xs=[25,240,660,1120,1380,1570];ys=[25,100,175,250,325]
for x in xs:draw.line((x,25,x,325),fill='black',width=2)
for y in ys:draw.line((25,y,1570,y),fill='black',width=2)
rows=[['父件编码','物料编码','物料名称','单件用量','单位'],['FG-01','RAW-01','钢板','2','件'],['FG-01','000050','螺钉','4','件'],['FG-01','RAW-02','垫片','1','件']]
for y,row in zip(ys,rows):
 for x,value in zip(xs,row):draw.text((x+12,y+20),value,font=font,fill='black')
im.save(root/'chinese-table.png')
ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
def workbook(sheets):
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
  archive.writestr('xl/workbook.xml',f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+''.join(f'<sheet name="{name}" sheetId="{n}" r:id="rId{n}"/>' for n,(name,_) in enumerate(sheets,1))+'</sheets></workbook>')
  archive.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Id="rId{n}" Target="worksheets/sheet{n}.xml"/>' for n in range(1,len(sheets)+1))+'</Relationships>')
  for n,(_,rows) in enumerate(sheets,1):
   body=''
   for ri,row in enumerate(rows,1):
    body+=f'<row r="{ri}">'+''.join(f'<c r="{chr(65+ci)}{ri}" t="inlineStr"><is><t>{value}</t></is></c>' for ci,value in enumerate(row) if value is not None)+'</row>'
   archive.writestr(f'xl/worksheets/sheet{n}.xml',f'<worksheet xmlns="{ns}"><sheetData>{body}</sheetData></worksheet>')
 return out.getvalue()
(root/'multi-sheet.xlsx').write_bytes(workbook([('装配一',[rows[0],rows[1]]),('装配二',[rows[0],['SUB-01','000050','螺钉','4','件']])]))
(root/'sparse.xlsx').write_bytes(workbook([('稀疏列',[['物料编码',None,'单件用量','单位'],['000050',None,'2','件']])]))
source=zipfile.ZipFile(io.BytesIO(workbook([('公式',[['物料编码','单件用量'],['RAW-01','2']])])))
buffer=io.BytesIO()
with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
 for name in source.namelist():
  content=source.read(name)
  if name.endswith('sheet1.xml'):content=content.replace(b'<c r="B2" t="inlineStr"><is><t>2</t></is></c>',b'<c r="B2"><f>1+1</f><v>2</v></c>')
  archive.writestr(name,content)
(root/'formula.xlsx').write_bytes(buffer.getvalue())
(root/'gbk.csv').write_bytes('父件编码,物料编码,物料名称,单件用量,单位\nFG-01,RAW-01,钢板,2,件'.encode('gb18030'))
(root/'utf16.tsv').write_bytes('父件编码\t物料编码\t单件用量\nFG-01\t000050\t4'.encode('utf-16'))
im.save(root/'table.jpg',quality=95)
exif=Image.Exif();exif[274]=3
im.rotate(180).save(root/'table-exif.jpg',quality=95,exif=exif)
merged=zipfile.ZipFile(io.BytesIO(workbook([('合并父件',[rows[0],rows[1],['','RAW-02','垫片','3','件']])])))
out=io.BytesIO()
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
 for name in merged.namelist():
  content=merged.read(name)
  if name.endswith('sheet1.xml'):content=content.replace(b'</sheetData>',b'</sheetData><mergeCells><mergeCell ref="A2:A3"/></mergeCells>')
  archive.writestr(name,content)
(root/'merged.xlsx').write_bytes(out.getvalue())
print('Created two image-only PDF controls, Chinese image table, and three XLSX controls.')
