"""Bounded PCB6 component inventory, not a CAD/DRC engine or a compiled assembly BOM.

Reads named CFB streams and checks their declared counts. Physical labels are read
from Texts6, never guessed from potentially repeated SOURCEDESIGNATOR fields.
Only the tested PCB6 text profile (240-byte core) is accepted; unknown layouts fail.
No third-party CAD reader code is imported or embedded in this module.
"""
import io, json, re, struct, sys

MAX_BYTES=8*1024*1024

def invalid():raise ValueError('DOCUMENT_INVALID')

class Reader:
    def __init__(self,data):self.data=data;self.offset=0
    def take(self,n):
        if n<0 or self.offset+n>len(self.data):invalid()
        value=self.data[self.offset:self.offset+n];self.offset+=n;return value
    def u32(self):return struct.unpack('<I',self.take(4))[0]
    def frame(self):
        n=self.u32()
        if n>>24:raise ValueError('DOCUMENT_FORMAT_UNSUPPORTED')
        if n>MAX_BYTES:raise ValueError('DOCUMENT_TOO_LARGE')
        return self.take(n)
    def remaining(self):return len(self.data)-self.offset

def props(data):
    try:text=data.rstrip(b'\0').decode('cp1252')
    except UnicodeDecodeError:invalid()
    result={}
    for entry in text.split('|'):
        if '=' not in entry:continue
        key,_,value=entry.partition('=');key=key.upper()
        if key in result and result[key]!=value:invalid()
        result[key]=value
    return result

def read_pcb(raw):
    if not raw or len(raw)>MAX_BYTES:raise ValueError('DOCUMENT_TOO_LARGE')
    if not raw.startswith(bytes.fromhex('D0CF11E0A1B11AE1')):invalid()
    import olefile
    with olefile.OleFileIO(io.BytesIO(raw),raise_defects=olefile.DEFECT_INCORRECT)as ole:
        entries=ole.listdir()
        if len(entries)>2048 or sum(ole.get_size(s)for s in entries)>32*1024*1024:raise ValueError('DOCUMENT_TOO_LARGE')
        def stream(name,required=True):
            if not ole.exists(name):
                if required:raise ValueError('DOCUMENT_FORMAT_UNSUPPORTED')
                return b''
            if ole.get_size(name)>MAX_BYTES:raise ValueError('DOCUMENT_TOO_LARGE')
            return ole.openstream(name).read()
        if b'PCB 6.0 Binary File'not in stream('FileHeaderSix'):raise ValueError('DOCUMENT_FORMAT_UNSUPPORTED')
        def count(name):
            value=stream(name+'/Header')
            if len(value)!=4:invalid()
            n=struct.unpack('<I',value)[0]
            if n>20000:raise ValueError('DOCUMENT_TOO_LARGE')
            return n
        def property_records(name):
            reader=Reader(stream(name+'/Data'));out=[]
            while reader.remaining():
                out.append(props(reader.frame()))
                if len(out)>2000:raise ValueError('DOCUMENT_TOO_LARGE')
            if len(out)!=count(name):invalid()
            return out
        components=property_records('Components6');nets=property_records('Nets6')
        wide={};reader=Reader(stream('WideStrings6/Data',False));legacy_empty=0
        while reader.remaining():
            idx=reader.u32();n=reader.u32()
            if n>32768 or n%2 or idx in wide:invalid()
            # Some PCB6 writers reserve 2 bytes for an empty wide string but write
            # no terminator. Accept only the unambiguous sequential-next-record case;
            # never consume the next index as a fabricated Unicode character.
            if n==2 and reader.remaining()>=8 and struct.unpack_from('<I',reader.data,reader.offset)[0]==idx+1:
                wide[idx]='';legacy_empty+=1;continue
            try:
                value=reader.take(n)
                if n and not value.endswith(b'\0\0'):invalid()
                wide[idx]=value.decode('utf-16le').rstrip('\0')
            except UnicodeDecodeError:invalid()
            if len(wide)>20000:raise ValueError('DOCUMENT_TOO_LARGE')
        if wide and ole.exists('WideStrings6/Header')and len(wide)!=count('WideStrings6'):invalid()
        labels={};comments={};reader=Reader(stream('Texts6/Data'));text_count=0
        while reader.remaining():
            if reader.take(1)!=b'\x05':raise ValueError('DOCUMENT_FORMAT_UNSUPPORTED')
            core=reader.frame();payload=reader.frame();text_count+=1
            if len(core)!=240:raise ValueError('DOCUMENT_FORMAT_UNSUPPORTED')
            if not payload or payload[0]+1!=len(payload):invalid()
            component=struct.unpack_from('<h',core,7)[0];wide_index=struct.unpack_from('<i',core,115)[0]
            if component>=len(components)or component < -1:invalid()
            if wide_index>=0:
                if wide_index not in wide:invalid()
                value=wide[wide_index]
            else:
                try:value=payload[1:].decode('cp1252')
                except UnicodeDecodeError:invalid()
            if component>=0:
                if core[41]&1:labels.setdefault(component,[]).append(value)
                if core[40]&1:comments.setdefault(component,[]).append(value)
            if text_count>20000:raise ValueError('DOCUMENT_TOO_LARGE')
        if text_count!=count('Texts6'):invalid()
        objects=[]
        for index,component in enumerate(components):
            values=list(dict.fromkeys(labels.get(index,[])));notes=[]
            ref=values[0]if len(values)==1 and values[0]and not values[0].startswith('.')else ''
            if not ref:notes.append('板上实际位号缺失或存在多个候选，未采用来源位号代替')
            elif not re.fullmatch(r'[A-Za-z]{1,8}\d+[A-Za-z]?',ref):notes.append('板上位号不是单个标准位号，不按文本范围展开器件')
            model=component.get('SOURCELIBREFERENCE','');comment_values=list(dict.fromkeys(comments.get(index,[])))
            comment=comment_values[0]if len(comment_values)==1 else ''
            source_ref=component.get('SOURCEDESIGNATOR','');source_uid=component.get('SOURCEUNIQUEID','')
            if source_ref and source_ref!=ref:notes.append('来源位号与板上位号不同，须结合层级和来源ID核对')
            if not source_uid:notes.append('缺少原理图来源ID，不能确认该布局对象是否属于装配BOM')
            # Library symbol names/comments are model hints, never manufacturer part numbers.
            mpns=list(dict.fromkeys(component[k]for k in ['MPN','MANUFACTURERPARTNUMBER','MANUFACTURER PART NUMBER']if component.get(k)))
            mpn=mpns[0]if len(mpns)==1 else ''
            if not mpn:notes.append('PCB未提供明确制造商料号；库名称和注释未当作MPN')
            population=component.get('FITTED','').upper()
            if population not in ['TRUE','FALSE']:population='UNKNOWN';notes.append('装配变体/是否贴装未确认；对象数量不等于已确认生产用量')
            objects.append({'index':index,'objectId':component.get('UNIQUEID',''),'designator':ref,'sourceDesignator':source_ref,'sourceUniqueId':source_uid,'hierarchy':component.get('SOURCEHIERARCHICALPATH',''),'footprint':component.get('PATTERN',''),'modelHint':model,'comment':comment,'mpn':mpn,'manufacturer':component.get('MANUFACTURER',''),'population':population,'x':component.get('X',''),'y':component.get('Y',''),'rotation':component.get('ROTATION',''),'layer':component.get('LAYER',''),'layoutCount':1,'warnings':notes})
        seen={}
        for obj in objects:
            ref=obj['designator']
            if ref:seen.setdefault(ref,[]).append(obj)
        for matches in seen.values():
            if len(matches)>1:
                for obj in matches:obj['warnings'].append('板上实际位号重复，不能据此合并BOM')
        # A nonempty parameter extension may carry assembly facts this reader does not decode.
        extension=bool(stream('PrimitiveParameters/Data',False))
        warnings=['当前结果为PCB布局对象清点；不证明装配变体、采购料号、网络连通或DRC合格']
        if extension:warnings.append('存在尚未解析的器件参数扩展，必须与已编译BOM核对')
        if legacy_empty:warnings.append('文件含历史空字符串编码，已按空值保留，未猜填内容')
        return {'profile':'PCB6-240','components':objects,'counts':{'components':len(objects),'nets':len(nets),'texts':text_count},'netNames':[x.get('NAME','')for x in nets],'warnings':warnings,'verification':'layout-inventory-only'}

def knowledge_blocks(inventory):
    blocks=[{'text':'PCB原生布局清点；'+ '；'.join(inventory['warnings'])+'\n'+json.dumps(inventory['counts'],ensure_ascii=False),'locator':{'block':'pcb-summary','verification':'layout-inventory-only'}}]
    for obj in inventory['components']:
        text='\n'.join(['板上实际位号：'+(obj['designator']or'未确认'),'来源位号：'+(obj['sourceDesignator']or'未提供'),'来源层级：'+obj['hierarchy'],'来源组件ID：'+obj['sourceUniqueId'],'封装：'+obj['footprint'],'库型号提示（不是MPN）：'+obj['modelHint'],'注释：'+obj['comment'],'明确MPN：'+(obj['mpn']or'未提供'),'装配状态：'+obj['population'],'板上对象数：1（装配用量待核对）','；'.join(obj['warnings'])])
        blocks.append({'text':text,'locator':{'block':'pcb-component','componentIndex':obj['index'],'objectId':obj['objectId'],'sourceUniqueId':obj['sourceUniqueId'],'sourceHierarchy':obj['hierarchy'],'stream':'Components6/Data + Texts6/Data','verification':'layout-inventory-only'}})
    return blocks

if __name__=='__main__':
    try:
        result=read_pcb(sys.stdin.buffer.read(MAX_BYTES+1))
        print(json.dumps(knowledge_blocks(result)if len(sys.argv)>1 and sys.argv[1]=='knowledge'else result,ensure_ascii=False))
    except Exception as error:
        code=str(error)if str(error)in ['DOCUMENT_INVALID','DOCUMENT_TOO_LARGE','DOCUMENT_FORMAT_UNSUPPORTED']else'DOCUMENT_INVALID'
        print(code,file=sys.stderr);sys.exit(1)
