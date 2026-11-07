import type { KnowledgeModelBudget } from './knowledge-model-budget';
import { mkdtemp, readFile, writeFile, rm, stat, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Binding } from '../platform/infrastructure-contract';
import { cloudOcr } from './knowledge-addons';
import { knowledgeModelsEnabled } from './knowledge-policy';
import { command, NativeKnowledgeError, type Block } from './native-parser';

export type OcrOptions = { binding?: Binding | null; signal?: AbortSignal; disabled?: boolean; budget?:KnowledgeModelBudget };
export async function cleanupOcrTemps() {
  for (const name of await readdir(tmpdir())) {
    if (!/^suite-ocr-[A-Za-z0-9]{6}$/.test(name)) continue;
    const directory = join(tmpdir(), name);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || Date.now() - info.mtimeMs < 600_000) continue;
      const marker = await lstat(join(directory, '.owner'));
      if (!marker.isFile() || marker.size > 100 || await readFile(join(directory, '.owner'), 'utf8') !== 'suite-native-ocr-v1') continue;
      await rm(directory, { recursive: true, force: true });
    } catch { /* Another process may already have cleaned its directory. */ }
  }
}
/** Read dimensions before letting an image decoder allocate memory. */
export function imageMime(bytes: Buffer): string {
  let width = 0, height = 0, mime = '';
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); mime = 'image/png';
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) throw new NativeKnowledgeError('DOCUMENT_INVALID');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++]; if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) throw new NativeKnowledgeError('DOCUMENT_INVALID');
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) { height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); mime = 'image/jpeg'; break; }
      offset += length;
    }
  }
  if (!width || !height || !mime) throw new NativeKnowledgeError('DOCUMENT_INVALID');
  if (width * height > 12_000_000 || width > 10000 || height > 10000) throw new NativeKnowledgeError('OCR_IMAGE_TOO_LARGE');
  return mime;
}
export async function recognizeImage(bytes: Buffer, options: OcrOptions = {}): Promise<string> {
  if (options.disabled) throw new NativeKnowledgeError('OCR_DISABLED');
  if (bytes.length > 8 * 1024 * 1024) throw new NativeKnowledgeError('OCR_IMAGE_TOO_LARGE');
  const mime = imageMime(bytes);
  if (options.binding?.enabled&&knowledgeModelsEnabled()) return cloudOcr(options.binding, bytes, mime, options.signal,options.budget);
  return command(process.env.KNOWLEDGE_TESSERACT_PATH ?? 'tesseract', ['stdin', 'stdout', '-l', 'chi_sim+eng', '--oem', '1', '--psm', '3'], bytes, options.signal, 'OCR_UNAVAILABLE');
}
export async function pdfWithOcr(bytes: Buffer, pages: string[], options: OcrOptions): Promise<Block[]> {
  // A trailing form feed is not another page.
  if (!pages.at(-1)?.trim()) pages = pages.slice(0, -1);
  if (!pages.length) throw new NativeKnowledgeError('DOCUMENT_EMPTY');
  if (pages.length > 120) throw new NativeKnowledgeError('OCR_PAGE_LIMIT');
  if (options.disabled && pages.every(text => !text.trim())) throw new NativeKnowledgeError('PDF_NO_TEXT');
  const directory = await mkdtemp(join(tmpdir(), 'suite-ocr-'));
  try {
    await writeFile(join(directory, '.owner'), 'suite-native-ocr-v1', { mode: 0o600 });
    const file = join(directory, 'source.pdf'); await writeFile(file, bytes, { mode: 0o600 });
    const imagePages=new Set<number>();
    if(pages.some(text=>text.trim()&&text.replace(/\s/g,'').length<80)&&!options.disabled){
      const listing=await command(process.env.KNOWLEDGE_PDFIMAGES_PATH??'pdfimages',['-list',file],Buffer.alloc(0),options.signal);
      for(const line of listing.split('\n')){const fields=line.trim().split(/\s+/);if(/^\d+$/.test(fields[0])&&fields[2]==='image'&&Number(fields[3])>=256&&Number(fields[4])>=256)imagePages.add(Number(fields[0]));}
    }
    const needsOcr=(text:string,page:number)=>!text.trim()||(text.replace(/\s/g,'').length<80&&imagePages.has(page));
    if(pages.filter((text,i)=>needsOcr(text,i+1)).length>20)throw new NativeKnowledgeError('OCR_PAGE_LIMIT');
    const drawing=pages.some(text=>/\b(?:schematic|toleranc\w*|dimension\w*|drawing)\b|原理图|公差|加工图|图纸/i.test(text));
    const vision=Boolean(options.binding?.enabled&&knowledgeModelsEnabled());
    let diagramPages=0;
    const blocks: Block[] = []; let total = 0;
    for (let i = 0; i < pages.length; i++) {
      let text = pages[i], ocr = false;
      // Sparse selectable drawing notes can hide vectorized/rotated dimensions.
      // Only an already configured vision OCR provider supplements them; at most two
      // pages per document. Never fan out an expensive full-drawing retry campaign.
      const diagram=drawing&&vision&&text.replace(/\s/g,'').length<1500&&!needsOcr(text,i+1);
      const supplement=diagram&&diagramPages<2;
      if ((needsOcr(text,i+1)||supplement)&&!options.disabled) {
        if(supplement)diagramPages++;
        const prefix = join(directory, 'page');
        await command(process.env.KNOWLEDGE_PDFTOPPM_PATH ?? 'pdftoppm', ['-f', String(i + 1), '-l', String(i + 1), '-singlefile', '-scale-to', '2400', '-png', file, prefix], Buffer.alloc(0), options.signal);
        const rendered = prefix + '.png';
        if ((await stat(rendered)).size > 8 * 1024 * 1024) throw new NativeKnowledgeError('OCR_IMAGE_TOO_LARGE');
        const recognized=await recognizeImage(await readFile(rendered), options);
        // Preserve native annotations when a mostly scanned page contains a selectable footer.
        if(recognized.trim()){const original=text.trim();text=recognized+(original&&!recognized.includes(original)?'\n'+original:'');ocr=true;}
        await rm(rendered, { force: true });
      }
      total += text.length; if (total > 180000) throw new NativeKnowledgeError('DOCUMENT_TOO_LARGE');
      blocks.push({ text, locator: { positions: [[i + 1]], ...(drawing?{engineeringDrawing:true,verification:'unverified-diagram',warning:'工程图文本不保证包含图形尺寸、公差、连线及装配关系；不得仅据片段生成完整BOM',...(diagram&&!supplement?{diagramOcrSkipped:'two-page-supplement-limit'}:{})}:{}), ...(ocr ? { ocr: true, ocrProvider: options.binding?.enabled&&knowledgeModelsEnabled() ? 'openai-vision' : 'tesseract' } : {}) } });
    }
    return blocks;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
