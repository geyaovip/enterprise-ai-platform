const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { parseNativeDocument, command } = require('../dist/modules/knowledge/native-parser');
const { imageMime } = require('../dist/modules/knowledge/native-ocr');
const { queryTerms, localRerank } = require('../dist/modules/knowledge/native-ranking');

function images() {
  const result = spawnSync(process.env.KNOWLEDGE_PYTHON_PATH ?? 'python3', ['-c', `
from PIL import Image, ImageDraw, ImageFont
import io, json, base64, os
image=Image.new('RGB',(1600,300),'white')
font=ImageFont.truetype(os.environ.get('NATIVE_QA_FONT','/System/Library/Fonts/Supplemental/Arial.ttf'),70)
ImageDraw.Draw(image).text((50,90),'SKU-ZX9 APPROVAL 24680',font=font,fill='black')
result={}
for kind in ('PNG','JPEG','PDF'):
 out=io.BytesIO();image.save(out,format=kind);result[kind.lower()]=base64.b64encode(out.getvalue()).decode()
font_path='/System/Library/Fonts/STHeiti Medium.ttc'
if os.path.exists(font_path):
 chinese=Image.new('RGB',(1800,300),'white');font=ImageFont.truetype(font_path,90)
 ImageDraw.Draw(chinese).text((50,90),'采购审批阈值 24680',font=font,fill='black')
 out=io.BytesIO();chinese.save(out,format='PNG');result['chinese']=base64.b64encode(out.getvalue()).decode()
print(json.dumps(result))`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(Object.entries(JSON.parse(result.stdout)).map(([k, v]) => [k, Buffer.from(v, 'base64')]));
}
async function parserChecks() {
  await assert.rejects(() => command(process.env.KNOWLEDGE_PYTHON_PATH ?? 'python3', ['-c', 'import os, signal; print("partial OCR text", flush=True); os.kill(os.getpid(), signal.SIGTERM)'], Buffer.alloc(0)), e => e.code === 'DOCUMENT_INVALID');
  const fixture = images(); const before = (await readdir(tmpdir())).filter(x => x.startsWith('suite-ocr-'));
  for (const [kind, filename] of [['png', 'scan.png'], ['jpeg', 'scan.jpg'], ['pdf', 'scan.pdf']]) {
    const chunks = await parseNativeDocument(filename, fixture[kind]);
    assert.ok(chunks.some(c => c.text.includes('24680')), JSON.stringify(chunks));
    assert.equal(chunks[0].locator.ocr, true); assert.equal(chunks[0].locator.ocrProvider, 'tesseract');
    if (kind === 'pdf') assert.equal(chunks[0].locator.positions[0][0], 1);
  }
  if (fixture.chinese) { const chinese = await parseNativeDocument('中文截图.png', fixture.chinese); assert.ok(chinese.some(c => c.text.includes('采购') && c.text.includes('24680')), JSON.stringify(chinese)); }
  assert.deepEqual((await readdir(tmpdir())).filter(x => x.startsWith('suite-ocr-')), before, 'OCR temporary files cleaned');
  const oversized = Buffer.from(fixture.png); oversized.writeUInt32BE(12000, 16);
  assert.throws(() => imageMime(oversized), e => e.code === 'OCR_IMAGE_TOO_LARGE');
  assert.throws(() => imageMime(Buffer.from('fake PNG')), e => e.code === 'DOCUMENT_INVALID');
  const signal = AbortSignal.abort(); await assert.rejects(() => parseNativeDocument('aborted.pdf', fixture.pdf, { signal }), e => e.code === 'PARSER_TIMEOUT');
  assert.deepEqual((await readdir(tmpdir())).filter(x => x.startsWith('suite-ocr-')), before);
  const md = '# 财务\n## 采购审批\n采购审批阈值 13579。\n\n```js\n# not a heading\nconst limit = 13579;\n```\n\n| 项目 | 阈值 |\n| --- | --- |\n| 采购 | 13579 |\n\n## 销售审批\n销售审批阈值 24680。';
  const chunks = await parseNativeDocument('rules.md', Buffer.from(md));
  assert.ok(chunks.every(c => !(c.text.includes('采购审批阈值') && c.text.includes('销售审批阈值'))));
  assert.ok(chunks.find(c => c.locator.block === 'code').locator.headings.includes('采购审批'));
  assert.ok(chunks.find(c => c.locator.block === 'table').text.includes('项目'));
  assert.ok(chunks.find(c => c.text.includes('销售审批阈值')).locator.headings.includes('销售审批'));
  assert.ok(queryTerms('SKU-ZX9采购审批').some(t => t.text === 'sku-zx9' && t.weight === 4));
  assert.equal(localRerank([{ text: '相关采购制度' }, { text: '采购 SKU-ZX9 规则' }], 'SKU-ZX9')[0].text, '采购 SKU-ZX9 规则');
  return fixture;
}
module.exports = { parserChecks };
if (require.main === module) parserChecks().then(() => console.log('Real PNG/JPEG/scanned PDF OCR, structure chunking, image bounds, cancellation and temporary cleanup passed.')).catch(e => { console.error(e); process.exitCode = 1; });
