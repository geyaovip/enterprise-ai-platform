import { BadRequestException } from '@nestjs/common';

export type MasterKind = 'customers' | 'products' | 'suppliers';
export const CSV_FIELDS: Record<MasterKind, Record<string, string>> = {
  customers: { code: '客户编号', name: '名称', contactName: '联系人', phone: '电话', industry: '行业' },
  products: { sku: '商品编码', name: '名称', category: '类别', unit: '单位', salePrice: '售价', purchasePrice: '采购价', reorderPoint: '低库存阈值' },
  suppliers: { code: '供应商编号', name: '名称', contactName: '联系人', phone: '电话' },
};

// RFC-style quoted cells, embedded newlines and UTF-8 BOM; bounded before parsing.
export function parseCsv(csv: string) {
  if (Buffer.byteLength(csv, 'utf8') > 512 * 1024) throw new BadRequestException('CSV 文件不能超过 512 KiB');
  const source = csv.replace(/^\uFEFF/, '');
  if (source.includes('\u0000')) throw new BadRequestException('CSV 包含无效空字符');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; };
  const pushRow = () => { pushCell(); if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > 501) throw new BadRequestException('每次最多导入 500 条资料'); };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === ',') pushCell();
    else if (c === '\r' || c === '\n') { if (c === '\r' && source[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"') { if (cell || closed) throw new BadRequestException('CSV 引号格式错误'); quoted = true; }
    else { if (closed) throw new BadRequestException('CSV 引号后只能是逗号或换行'); cell += c; }
  }
  if (quoted) throw new BadRequestException('CSV 引号没有闭合');
  if (cell || row.length || closed) pushRow();
  if (rows.length < 2) throw new BadRequestException('CSV 必须包含表头和至少一条资料');
  return rows;
}

export function encodeCsv(rows: unknown[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let cell = String(value ?? '');
    // Prevent spreadsheet formula execution, including leading whitespace/control characters.
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n') + '\r\n';
}
