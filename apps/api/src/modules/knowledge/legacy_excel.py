"""Read bounded BIFF8 cells. Never execute macros or adopt cached formula results."""
import io, math, re, struct

def read_xls(raw):
    if len(raw)>8*1024*1024 or not raw.startswith(bytes.fromhex('D0CF11E0A1B11AE1')):
        raise ValueError('DOCUMENT_INVALID')
    import xlrd
    from xlrd.compdoc import CompDoc
    compound=CompDoc(raw,logfile=io.StringIO())
    stream=compound.get_named_stream('Workbook') or compound.get_named_stream('Book')
    if not stream or len(stream)>16*1024*1024:raise ValueError('DOCUMENT_INVALID')
    # BIFF formula records include their row/column before the cached result.
    formulas={};current=None;offset=0
    while offset+4<=len(stream):
        code,length=struct.unpack_from('<HH',stream,offset)
        if offset+4+length>len(stream):raise ValueError('DOCUMENT_INVALID')
        payload=stream[offset+4:offset+4+length]
        if code==0x0809 and length>=4:
            current=offset if struct.unpack_from('<H',payload,2)[0]==0x0010 else None
        if code==0x0006 and current is not None and length>=6:
            formulas.setdefault(current,set()).add(struct.unpack_from('<HH',payload))
        offset+=4+length
    book=xlrd.open_workbook(file_contents=raw,formatting_info=True,on_demand=True,logfile=io.StringIO())
    try:
        if book.biff_version!=80:raise ValueError('DOCUMENT_FORMAT_UNSUPPORTED')
        if book.nsheets>64:raise ValueError('DOCUMENT_TOO_LARGE')
        total=0;sheets=[]
        for si in range(book.nsheets):
            sheet=book.sheet_by_index(si)
            if sheet.nrows>20000 or sheet.ncols>64:raise ValueError('DOCUMENT_TOO_LARGE')
            total+=sheet.nrows*sheet.ncols
            if total>20000:raise ValueError('DOCUMENT_TOO_LARGE')
            rows=[];formula_cells=formulas.get(book._sh_abs_posn[si]-book.base,set())
            for ri in range(sheet.nrows):
                row=[]
                for ci in range(sheet.ncols):
                    cell=sheet.cell(ri,ci)
                    if (ri,ci) in formula_cells:value=''
                    elif cell.ctype==xlrd.XL_CELL_NUMBER:
                        n=cell.value
                        if not math.isfinite(n):raise ValueError('DOCUMENT_INVALID')
                        value=str(int(n)) if n.is_integer() else repr(n)
                        xf=book.xf_list[cell.xf_index];fmt=book.format_map[xf.format_key].format_str
                        if re.fullmatch(r'0{2,20}',fmt)and re.fullmatch(r'\d+',value):value=value.zfill(len(fmt))
                    elif cell.ctype==xlrd.XL_CELL_BOOLEAN:value='TRUE' if cell.value else 'FALSE'
                    elif cell.ctype in (xlrd.XL_CELL_DATE,xlrd.XL_CELL_ERROR):value='[日期或错误单元格，须核对]'
                    else:value=str(cell.value)
                    row.append(value)
                rows.append(row)
            sheets.append({'name':sheet.name,'rows':rows,'formulaCells':sorted(formula_cells),'merged':sheet.merged_cells})
            book.unload_sheet(si)
        return sheets
    finally:book.release_resources()
