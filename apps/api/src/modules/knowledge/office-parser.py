"""Bounded, read-only Office XML extraction. Never extracts ZIP entries to disk."""
import sys, io, json, zipfile, posixpath
from xml.etree import ElementTree as ET

def main():
    raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024: raise ValueError('DOCUMENT_TOO_LARGE')
    archive = zipfile.ZipFile(io.BytesIO(raw))
    entries = archive.infolist()
    if len(entries) > 2048 or sum(e.file_size for e in entries) > 32 * 1024 * 1024:
        raise ValueError('DOCUMENT_TOO_LARGE')
    if any(e.flag_bits & 1 or e.file_size > 8 * 1024 * 1024 or e.file_size > max(1, e.compress_size) * 1000 for e in entries):
        raise ValueError('DOCUMENT_TOO_LARGE')
    def xml(name):
        content = archive.read(name)
        if b'<!DOCTYPE' in content.upper() or b'<!ENTITY' in content.upper(): raise ValueError('DOCUMENT_INVALID')
        return ET.fromstring(content)
    blocks, length = [], 0
    def add(text, locator):
        nonlocal length
        text = text.strip()
        if not text: return
        length += len(text)
        if length > 180000 or len(blocks) >= 20000: raise ValueError('DOCUMENT_TOO_LARGE')
        blocks.append({'text': text, 'locator': locator})
    if sys.argv[1] == 'docx':
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        headings, paragraph_index, table_index = [], 0, 0
        body = xml('word/document.xml').find('w:body', ns)
        for element in body:
            if element.tag == '{' + ns['w'] + '}tbl':
                table_index += 1
                header = ''
                for row_index, row in enumerate(element.findall('w:tr', ns), 1):
                    values = [' '.join(t.text or '' for t in cell.findall('.//w:t', ns)) for cell in row.findall('w:tc', ns)]
                    if row_index == 1: header = ' | '.join(values)[:200]
                    add(' | '.join(values), {'tableHeader': header, 'table': table_index, 'row': row_index, 'headings': list(headings), 'block': 'table'})
            elif element.tag == '{' + ns['w'] + '}p':
                paragraph_index += 1
                text = ''.join(t.text or '' for t in element.findall('.//w:t', ns))
                style = element.find('w:pPr/w:pStyle', ns)
                outline = element.find('w:pPr/w:outlineLvl', ns)
                value = style.attrib.get('{' + ns['w'] + '}val', '') if style is not None else ''
                import re
                match = re.match(r'(?:heading|标题)([1-6])$', value, re.I)
                level = int(match.group(1)) if match else int(outline.attrib.get('{' + ns['w'] + '}val', '9')) + 1 if outline is not None else 10
                if level <= 6 and text.strip():
                    headings = headings[:level - 1]
                    headings.append(text.strip())
                add(text, {'paragraph': paragraph_index, 'headings': list(headings), 'block': 'paragraph'})
    else:
        ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(t.text or '' for t in si.findall('.//s:t', ns)) for si in xml('xl/sharedStrings.xml').findall('s:si', ns)]
        relationships = {r.attrib['Id']: r.attrib['Target'] for r in xml('xl/_rels/workbook.xml.rels')}
        cells = 0
        for sheet in xml('xl/workbook.xml').findall('s:sheets/s:sheet', ns):
            target = relationships[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            path = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/' + target)
            if not path.startswith('xl/'): raise ValueError('DOCUMENT_INVALID')
            header = ''
            for row in xml(path).findall('s:sheetData/s:row', ns):
                values = []
                for cell in row.findall('s:c', ns):
                    cells += 1
                    if cells > 20000: raise ValueError('DOCUMENT_TOO_LARGE')
                    value = cell.findtext('s:v', default='', namespaces=ns)
                    kind = cell.attrib.get('t')
                    if kind == 's': value = shared[int(value)]
                    elif kind == 'inlineStr': value = ''.join(t.text or '' for t in cell.findall('.//s:t', ns))
                    values.append(value)
                if not header: header = ' | '.join(values)[:200]
                add(' | '.join(values), {'tableHeader': header, 'sheet': sheet.attrib.get('name', ''), 'row': int(row.attrib.get('r', 0))})
    print(json.dumps(blocks, ensure_ascii=False))

try:
    main()
except Exception as error:
    code = str(error) if str(error) in ('DOCUMENT_TOO_LARGE', 'DOCUMENT_INVALID') else 'DOCUMENT_INVALID'
    print(code, file=sys.stderr)
    sys.exit(1)
