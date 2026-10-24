import { useState } from 'react';
import { ConfirmDialog, Field, Notice } from '../components';
export type KnowledgeEngineStatus = { provider: string | null; version: number; embeddingCloud: boolean; enhancements?: { retrieval: string; chunking: string; ocr: string; reranker: string; ocrCloud: boolean; rerankCloud: boolean } | null; formats: string[]; choices: Array<{ provider: string; name: string; configured: boolean; hasUpdate: boolean }>; rollbackAvailable: boolean; transition: { id: string; provider: string; status: string; ready: number; total: number; errorCode: string | null } | null };
export const knowledgeErrors: Record<string, string> = {
  DOCUMENT_FORMAT_UNSUPPORTED: '当前轻量引擎不支持此格式。请转换为普通 PDF、DOCX、XLSX 或 UTF-8 文本，或选择其他引擎。',
  PDF_NO_TEXT: 'PDF 没有可提取文字，请启用 OCR 或重新导出后上传。',
  OCR_UNAVAILABLE: '文字识别服务暂不可用，请联系管理员检查 OCR 组件后重新处理。',
  OCR_INVALID: '文字识别返回不完整或无效内容，请重新处理或检查模型。',
  OCR_DISABLED: '文字识别尚未启用，请联系管理员。',
  OCR_PAGE_LIMIT: 'PDF 最多 120 页，其中扫描或空白页最多 20 页，请拆分后上传。',
  OCR_IMAGE_TOO_LARGE: '图片超过 1200 万像素或识别图片超过 8 MiB，请缩小后上传。',
  DOCUMENT_ENCODING: '文本编码无法读取，请转换为 UTF-8 后重新上传。',
  DOCUMENT_INVALID: '文件内容无法读取，请检查格式或重新导出后上传。',
  DOCUMENT_EMPTY: '未提取到可检索文字，请检查原文内容。',
  DOCUMENT_TOO_LARGE: '文档解压后或提取后的内容过多，请拆分文档后上传。',
  PARSER_UNAVAILABLE: '文档解析组件尚未配置，请联系平台管理员。',
  PARSER_TIMEOUT: '文档解析超时，请拆分或重新导出文档。',
  EMBEDDING_UNAVAILABLE: '嵌入模型暂不可用，请联系管理员检查连接后重新处理。',
  EMBEDDING_INVALID: '嵌入模型返回无效数据，请联系管理员检查模型配置。',
  EMBEDDING_DIMENSION_CHANGED: '模型向量维度发生变化，请联系管理员重新配置并重建索引。',
  VECTOR_EXTENSION_UNAVAILABLE: '向量检索组件尚未配置，请联系平台管理员。',
  CONFIGURATION_CHANGED: '配置或权限已变化，本次切换已停止。',
  SOURCE_CHANGED: '文档已变化，请刷新状态后重新处理。',
};
export function KnowledgeEngineSettings({ data, manage, busy, action }: { data: KnowledgeEngineStatus; manage: boolean; busy: boolean; action: (kind: string, body: object) => Promise<void> }) {
  const [choice, setChoice] = useState(''); const [pending, setPending] = useState<'select' | 'rollback' | 'cancel' | null>(null);
  const building = data.transition?.status === 'building';
  const providerName = (provider: string | null) => data.choices.find(x => x.provider === provider)?.name ?? '尚未开通';
  return <section className="panel"><h2>知识库服务</h2><p>当前使用：{providerName(data.provider)}</p>
    
    
    
    
    {building && <div role="status" aria-live="polite"><p>正在准备 {providerName(data.transition!.provider)} · {data.transition!.ready} / {data.transition!.total} 份文档已完成</p>{manage && <button disabled={busy} onClick={() => setPending('cancel')}>取消切换</button>}</div>}
    {data.transition?.status === 'failed' && <Notice text={`切换未完成，当前引擎继续使用。${knowledgeErrors[data.transition.errorCode ?? ''] ?? '请联系管理员检查目标服务和文档处理状态。'}`} />}
    {data.transition?.status === 'completed' && <Notice tone="success" text="知识引擎切换已完成。原件、权限和原有引用保持可用。" />}
    {data.transition?.status === 'cancelled' && <p>上次切换已取消，当前引擎继续使用。</p>}
    {manage && <><div className="toolbar"><Field label="切换知识库方案"><select disabled={busy || building || !data.provider} value={choice} onChange={e => setChoice(e.target.value)}><option value="">选择其他方案</option>{data.choices.filter(x => x.provider !== data.provider || x.hasUpdate).map(x => <option key={x.provider} value={x.provider} disabled={!x.configured}>{x.name}{x.hasUpdate ? ' \u00b7 \u66f4\u65b0\u6a21\u578b\u914d\u7f6e' : ''}{x.configured ? '' : ' · 待配置'}</option>)}</select></Field><button disabled={busy || building || !choice || !data.provider} onClick={() => setPending('select')}>准备并切换</button>{data.rollbackAvailable && <button disabled={busy || building} onClick={() => setPending('rollback')}>回退到上次方案</button>}</div></>}
    <ConfirmDialog open={Boolean(pending)} title={pending === 'cancel' ? '取消知识引擎切换' : pending === 'rollback' ? '回退知识引擎' : '切换知识引擎'} description={<p>{pending === 'cancel' ? '停止准备并清理候选索引，当前引擎继续使用。' : '将使用目标方案配置的模型或服务处理现有文档。如使用云端服务，文档内容会发送至该服务。重建成功后自动启用；失败时继续使用当前引擎。'}</p>} busy={busy} onCancel={() => setPending(null)} onConfirm={() => { const kind = pending!; void action(kind, kind === 'cancel' ? { id: data.transition!.id } : { version: data.version, ...(kind === 'select' ? { provider: choice } : {}) }).then(() => { setPending(null); setChoice(''); }).catch(() => {}); }} />
  </section>;
}
