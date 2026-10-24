import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { pdfWithOcr, recognizeImage, type OcrOptions } from './native-ocr';

const messages: Record<string, string> = {
  EMBEDDING_UNAVAILABLE: '嵌入模型暂不可用，请稍后重试或联系管理员检查模型连接。',
  EMBEDDING_INVALID: '嵌入模型返回无效数据，请联系管理员检查配置。',
  EMBEDDING_DIMENSION_CHANGED: '嵌入模型维度已变化，请联系管理员重新配置并重建索引。',
  VECTOR_EXTENSION_UNAVAILABLE: '向量检索组件尚未配置，请联系平台管理员。',
};
export class NativeKnowledgeError extends ServiceUnavailableException { constructor(public readonly code: string) { super(messages[code] ?? '文档处理未完成，请检查文档处理状态或联系管理员。'); this.name = code; } }
export type Block = { text: string; locator: Record<string, unknown> };
export const nativeFormats = ['txt', 'md', 'csv', 'pdf', 'docx', 'xlsx', 'png', 'jpg', 'jpeg'];
export function command(binary: string, args: string[], bytes: Buffer, signal?: AbortSignal, unavailable = 'PARSER_UNAVAILABLE'): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.KNOWLEDGE_PYTHON_PATH ?? 'python3', [join(__dirname, 'parser-runner.py'), binary, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
    const buffers: Buffer[] = []; let size = 0, stderr = '', done = false;
    const stop = () => { child.kill('SIGKILL'); finish(new NativeKnowledgeError('PARSER_TIMEOUT')); };
    const finish = (error?: Error, value?: string) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); if (error) reject(error); else resolve(value!); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new NativeKnowledgeError('PARSER_TIMEOUT')); }, 30_000);
    child.on('error', () => finish(new NativeKnowledgeError(unavailable)));
    signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
    child.stdout.on('data', (buf: Buffer) => { size += buf.length; if (size > 2 * 1024 * 1024) { child.kill('SIGKILL'); finish(new NativeKnowledgeError('DOCUMENT_TOO_LARGE')); } else buffers.push(buf); });
    child.stderr.on('data', (buf: Buffer) => { if (stderr.length < 1000) stderr += buf.toString(); });
    child.stdin.on('error', () => {});
    child.on('close', (code, signal) => finish(code !== 0 || signal ? new NativeKnowledgeError(signal === 'SIGXCPU' ? 'PARSER_TIMEOUT' : signal === 'SIGXFSZ' || stderr.includes('DOCUMENT_TOO_LARGE') ? 'DOCUMENT_TOO_LARGE' : stderr.includes('No such file or directory') ? unavailable : 'DOCUMENT_INVALID') : undefined, Buffer.concat(buffers).toString('utf8')));
    child.stdin.end(bytes);
  });
}
function markdownBlocks(text: string): Block[] {
  const headings: string[] = []; const blocks: Block[] = []; let fence = '', code = '', start = 0, table = 0, inTable = false, tableHeader = '';
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      code += '\n' + line;
      if (delimiter && delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) { blocks.push({ text: code, locator: { line: start + 1, end: { line: index + 1 }, headings: [...headings], block: 'code' } }); fence = ''; code = ''; }
      continue;
    }
    if (delimiter) { fence = delimiter[1]; code = line; start = index; continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    const underline = index + 1 < lines.length && /^\s{0,3}(=+|-+)\s*$/.test(lines[index + 1]) && line.trim() && !/^\s*[-*+]/.test(line);
    if (heading || underline) { const level = heading ? heading[1].length : lines[index + 1].trim()[0] === '=' ? 1 : 2; headings.length = level - 1; headings[level - 1] = heading ? heading[2] : line.trim(); }
    if (index && /^\s{0,3}(=+|-+)\s*$/.test(line) && blocks.at(-1)?.locator.line === index) continue;
    const tableRow = /^\s*\|/.test(line);
    if (tableRow && !inTable) { table++; tableHeader = index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]) ? line : ''; }
    inTable = tableRow;
    blocks.push({ text: line, locator: { line: index + 1, headings: headings.filter(Boolean), block: tableRow ? 'table' : 'paragraph', ...(tableRow ? { table, tableHeader } : {}) } });
  }
  if (code) blocks.push({ text: code, locator: { line: start + 1, end: { line: lines.length }, headings: [...headings], block: 'code' } });
  return blocks;
}
export async function parseNativeDocument(filename: string, bytes: Buffer, options: OcrOptions = {}): Promise<Block[]> {
  const ext = filename.split('.').at(-1)?.toLowerCase() ?? '';
  if (!nativeFormats.includes(ext)) throw new NativeKnowledgeError('DOCUMENT_FORMAT_UNSUPPORTED');
  let blocks: Block[];
  if (ext === 'pdf') {
    const text = await command(process.env.KNOWLEDGE_PDFTOTEXT_PATH ?? 'pdftotext', ['-layout', '-enc', 'UTF-8', '-', '-'], bytes, options.signal);
    if (text.length > 180000) throw new NativeKnowledgeError('DOCUMENT_TOO_LARGE');
    blocks = await pdfWithOcr(bytes, text.split('\f'), options);
  } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
    blocks = [{ text: await recognizeImage(bytes, options), locator: { image: true, ocr: true, ocrProvider: options.binding?.enabled ? 'openai-vision' : 'tesseract' } }];
  } else if (ext === 'docx' || ext === 'xlsx') {
    blocks = JSON.parse(await command(process.env.KNOWLEDGE_PYTHON_PATH ?? 'python3', [join(__dirname, 'office-parser.py'), ext], bytes, options.signal));
  } else {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new NativeKnowledgeError('DOCUMENT_ENCODING'); }
    if (text.length > 180000) throw new NativeKnowledgeError('DOCUMENT_TOO_LARGE');
    if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text)) throw new NativeKnowledgeError('DOCUMENT_INVALID');
    blocks = ext === 'md' ? markdownBlocks(text) : text.split(/\r?\n/).map((text, index) => ({ text, locator: { line: index + 1 } }));
  }
  if (blocks.reduce((sum, x) => sum + x.text.length, 0) > 180000) throw new NativeKnowledgeError('DOCUMENT_TOO_LARGE');
  const chunks: Block[] = []; let group: Block | undefined;
  const flush = () => { if (group) { chunks.push(group); group = undefined; } };
  for (const block of blocks) {
    const text = block.text.trim(); if (!text) continue;
    // Never combine separate sections, tables, code fences, pages or worksheets.
    const sameScope = group && block.locator.block !== 'code' && ['positions', 'sheet', 'headings', 'block', 'table'].every(key => JSON.stringify(group!.locator[key]) === JSON.stringify(block.locator[key]));
    if (group && sameScope && group.text.length + text.length + 1 <= 800) { group.text += '\n' + text; group.locator.end = block.locator; continue; }
    flush();
    for (let offset = 0; offset < text.length; offset += 720) {
      const chunk = { text: text.slice(offset, offset + 800), locator: { ...block.locator, offset } };
      if (offset + 800 >= text.length) { group = chunk; break; } chunks.push(chunk);
    }
  }
  flush();
  // Carry a short section path into every chunk for independent retrieval, without replacing its source locator.
  for (const chunk of chunks) {
    const headings = chunk.locator.headings as string[] | undefined;
    const header = chunk.locator.tableHeader;
    if (typeof header === 'string' && header && !chunk.text.startsWith(header)) chunk.text = header.slice(0, 200) + '\n' + chunk.text;
    if (headings?.length) { const path = headings.join(' / ').slice(0, 160); if (!chunk.text.startsWith(path)) chunk.text = path + '\n' + chunk.text; }
  }
  if (!chunks.length) throw new NativeKnowledgeError('DOCUMENT_EMPTY');
  if (chunks.length > 256) throw new NativeKnowledgeError('DOCUMENT_TOO_LARGE');
  return chunks;
}
