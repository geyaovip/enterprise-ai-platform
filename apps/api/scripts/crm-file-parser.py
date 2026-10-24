#!/usr/bin/env python3
"""Bounded CSV/XLSX parser. No formulas, macros, external relationships or network."""
import sys,json,base64,csv,io,zipfile,xml.etree.ElementTree as ET,re,datetime,resource
if sys.platform.startswith('linux'):resource.setrlimit(resource.RLIMIT_AS,(268435456,268435456))
MAX_ROWS=10000
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def xml(data):
 if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():raise ValueError('XML declarations not allowed')
 return ET.fromstring(data)
def main():
 request=json.load(sys.stdin);raw=base64.b64decode(request['contentBase64'],validate=True)
 if len(raw)>4194304:raise ValueError('文件超过4MiB上限')
 if request['format']=='csv':
  text=raw.decode('utf-8-sig');table=[];name='CSV'
  for row in csv.reader(io.StringIO(text),strict=True):
   if len(table)>MAX_ROWS:raise ValueError('文件超过10000行')
   if any(str(v).strip() for v in row):table.append(row)
 elif request['format']=='xlsx':
  z=zipfile.ZipFile(io.BytesIO(raw));info=z.infolist()
  if len(info)>100 or sum(f.file_size for f in info)>33554432 or any(f.flag_bits&1 for f in info):raise ValueError('工作簿已加密或展开大小超限')
  if any('vbaProject' in f.filename or f.filename.startswith('xl/externalLinks/') for f in info):raise ValueError('不支持宏或外部链接')
  for f in info:
   if '..' in f.filename.split('/') or f.filename.startswith('/'):raise ValueError('工作簿路径无效')
   if f.filename.endswith('.rels'):
    if any(e.attrib.get('TargetMode')=='External' for e in xml(z.read(f)).iter()):raise ValueError('不支持外部引用')
  wb=xml(z.read('xl/workbook.xml'));rels=xml(z.read('xl/_rels/workbook.xml.rels'));targets={e.attrib['Id']:e.attrib['Target'] for e in rels}
  sheets=wb.find('m:sheets',NS);name=request.get('sheetName') or sheets[0].attrib['name'];sheet=next((s for s in sheets if s.attrib['name']==name),None)
  if sheet is None:raise ValueError('找不到指定工作表')
  rid=sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'];target=targets[rid];target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
  shared=[]
  if 'xl/sharedStrings.xml' in z.namelist():shared=[''.join(e.itertext()) for e in xml(z.read('xl/sharedStrings.xml')).findall('m:si',NS)]
  table=[];cell_types=[]
  for row in xml(z.read(target)).findall('.//m:sheetData/m:row',NS):
   values=['']*100;types=['s']*100;last=-1
   for c in row.findall('m:c',NS):
    if c.find('m:f',NS) is not None:raise ValueError('不支持公式单元格，请转换为值')
    letters=re.match(r'[A-Z]+',c.attrib.get('r','A1')).group();column=0
    for char in letters:column=column*26+ord(char)-64
    column-=1
    if column>=100:raise ValueError('工作表超过100列')
    t=c.attrib.get('t','n');v=c.find('m:v',NS);value=v.text if v is not None and v.text is not None else ''
    if t=='s':value=shared[int(value)] if value else ''
    elif t=='inlineStr':value=''.join(c.find('m:is',NS).itertext())
    if len(value)>10000:raise ValueError('单元格文本过长')
    values[column]=value;types[column]=t;last=max(last,column)
   table.append(values[:last+1]);cell_types.append(types[:last+1])
   if len(table)>MAX_ROWS+1:raise ValueError('工作表超过10000行')
  # Excel numbers can have irrecoverably lost leading zeroes: IDs must be text.
  if table:
   for index,header in enumerate(table[0]):
    if header.startswith('external_') and header.endswith('_id') or header in ['phone','email']:
     for n,row in enumerate(table[1:],1):
      if index<len(row) and row[index] and cell_types[n][index] not in ['s','inlineStr','str']:raise ValueError('外部ID和联系方式须为文本单元格')
 else:raise ValueError('仅支持CSV或XLSX')
 if not table:raise ValueError('文件没有表头')
 headers=[h.strip() for h in table[0]]
 if not headers or len(headers)>100 or len(set(headers))!=len(headers) or any(not h for h in headers):raise ValueError('表头为空、重复或超过100列')
 rows=[]
 for number,row in enumerate(table[1:],2):
  if not any(str(v).strip() for v in row):continue
  if len(row)>len(headers):raise ValueError('行列数超过表头')
  rows.append({'rowNumber':number,'values':{h:str(row[i]).strip() if i<len(row) else '' for i,h in enumerate(headers)},'nonTextColumns':[h for i,h in enumerate(headers) if request['format']=='xlsx' and i<len(row) and row[i] and cell_types[number-1][i] not in ['s','inlineStr','str']]})
  if len(rows)>MAX_ROWS:raise ValueError('文件超过10000行')
 print(json.dumps({'sheetName':name,'headers':headers,'rows':rows},ensure_ascii=False))
try:main()
except Exception as e:
 print(json.dumps({'error':str(e)[:160]},ensure_ascii=False));sys.exit(1)
