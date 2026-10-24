import { BadRequestException } from '@nestjs/common';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const types: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', md: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
function storagePath(key: string) { if (!/^[a-f0-9-]{36}$/.test(key)) throw new BadRequestException('文件标识无效'); return join(resolve(process.env.KNOWLEDGE_STORAGE_DIR ?? 'var/knowledge'), key); }
export function decodeFile(filename: string, encoded: string) {
  const ext = filename.split('.').at(-1)?.toLowerCase() ?? '';
  const mimeType = types[ext];
  if (!mimeType || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new BadRequestException('文件类型或编码无效');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new BadRequestException('文件须在 1 字节至 8 MiB 之间');
  if (ext === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || ['docx', 'xlsx'].includes(ext) && (bytes.length < 2 || bytes.readUInt16LE(0) !== 0x4b50)) throw new BadRequestException('文件内容与扩展名不符');
  return { bytes, mimeType, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export async function storeOriginal(bytes: Buffer) { const key = randomUUID(); await mkdir(resolve(process.env.KNOWLEDGE_STORAGE_DIR ?? 'var/knowledge'), { recursive: true, mode: 0o700 }); await writeFile(storagePath(key), bytes, { flag: 'wx', mode: 0o600 }); return key; }
export async function readOriginal(key: string) { return readFile(storagePath(key)); }
export async function removeOriginal(key: string) { await unlink(storagePath(key)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
