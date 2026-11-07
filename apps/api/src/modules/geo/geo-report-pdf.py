"""Render a self-contained GEO report. All data enters through stdin; no network or HTML renderer."""
import json
import re
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit
from xml.sax.saxutils import escape, quoteattr
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

FONT = 'ArkReportSansSC'
INK = colors.HexColor('#202535')
MUTED = colors.HexColor('#596174')
BRAND = colors.HexColor('#5140b8')
LINE = colors.HexColor('#e2e5ee')
SOFT = colors.HexColor('#f5f3ff')
PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 42
WIDTH = PAGE_WIDTH - 2 * (MARGIN + 6)  # SimpleDocTemplate frame padding


def plain(value):
    if value is None:
        return '—'
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', str(value)).replace('\r\n', '\n').replace('\r', '\n')


def markup(value):
    return escape(plain(value)).replace('\n', '<br/>')


def safe_link(value, title):
    try:
        url = plain(value)
        parts = urlsplit(url)
        if parts.scheme in ('http', 'https') and parts.hostname and not parts.username and not parts.password and len(url) <= 2048:
            return '<link href=' + quoteattr(url) + ' color="#5140b8">' + markup(title) + '</link>'
    except ValueError:
        pass
    return markup(title)


def money(value):
    return '待核实' if value is None else '¥' + f'{value / 1_000_000:.6f}'.rstrip('0').rstrip('.')


def percentage(value):
    return '—' if value is None else f'{value:g}%'


STATES = {'succeeded':'成功','failed':'失败','skipped':'已跳过','cancelled':'已停止','outcome_unknown':'结果待核实','queued':'待执行','running':'执行中','completed':'已完成','partially_completed':'部分完成','needs_review':'结果待核实'}


def render(data):
    pdfmetrics.registerFont(TTFont(FONT, str(Path(__file__).parent / 'fonts' / 'ArkReportSansSC-Regular.ttf')))
    styles = {name: ParagraphStyle(name, fontName=FONT, fontSize=size, leading=leading,
                                   textColor=color, spaceBefore=before, spaceAfter=after,
                                   wordWrap='CJK', splitLongWords=1, keepWithNext=keep)
              for name, size, leading, color, before, after, keep in [
                  ('title', 24, 31, INK, 0, 7, True),
                  ('meta', 9.5, 14, MUTED, 0, 4, False),
                  ('body', 10.5, 16, INK, 0, 5, False),
                  ('section', 14, 20, INK, 12, 5, True),
                  ('question', 11.5, 17, INK, 8, 3, True),
                  ('label', 9.5, 16, MUTED, 0, 3, False),
                  ('value', 18, 26, BRAND, 0, 0, False),
              ]}
    def p(value, style='body'):
        return Paragraph(markup(value), styles[style])
    def rich(value, style='body'):
        return Paragraph(value, styles[style])
    def table(rows, widths, header=False):
        t = Table(rows, colWidths=widths, repeatRows=int(header), hAlign='LEFT')
        rules = [('VALIGN', (0,0), (-1,-1), 'TOP'), ('TOPPADDING', (0,0), (-1,-1), 6),
                 ('BOTTOMPADDING', (0,0), (-1,-1), 6), ('LEFTPADDING', (0,0), (-1,-1), 10),
                 ('RIGHTPADDING', (0,0), (-1,-1), 10), ('LINEBELOW', (0,0), (-1,-1), .4, LINE)]
        if header:
            rules.append(('BACKGROUND', (0,0), (-1,0), SOFT))
        t.setStyle(TableStyle(rules))
        return t
    report = data['report']
    title = plain(data['brand']) + ' · GEO 分析报告'
    timestamp = datetime.fromisoformat(data['createdAt'].replace('Z', '+00:00')).astimezone(ZoneInfo('Asia/Shanghai'))
    diagnostic = bool((report.get('score') or {}).get('diagnosticOnly'))
    samples = report['validSamples']
    source = data.get('sampleSource', '模型 API 抽样 · 不代表消费端 App 排名')
    if diagnostic:
        source += ' · 样本不足，仅供诊断'
    if data.get('legacy'):
        source += ' · 旧口径'
    story = [p(title, 'title'), p(timestamp.strftime('%Y-%m-%d %H:%M') + ' 北京时间 · ' + STATES.get(data['status'], '分析记录'), 'meta'),
             p('范围：' + plain(data['country']) + ' / ' + plain(data['language']), 'meta'),
             p(source, 'meta'), Spacer(1, 6)]
    def sample_value(rate, count=None):
        if rate is None or not samples:
            return '—'
        if diagnostic:
            return f"{count if count is not None else round(rate * samples / 100)}/{samples} 条"
        return percentage(rate)
    metrics = [('品牌提及' if diagnostic else '品牌提及率', sample_value(report['mentionRate'], report.get('mentionedSamples'))),
               ('品牌推荐' if diagnostic else '品牌推荐率', sample_value(report['recommendationRate'], report.get('recommendedSamples'))),
               ('样本内排名' if diagnostic else '平均排名', '—' if report['averageRank'] is None else f"{report['averageRank']:.1f}"),
               ('有效回答', f"{samples}/{report['plannedSamples']}")]
    summary = table([[[p(label,'label'), p(value,'value')] for label,value in metrics]], [WIDTH/4]*4)
    summary.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),SOFT),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story += [summary, Spacer(1, 7), p('预估费用 ' + money(data['estimated']) + '　实际费用 ' + money(data['actual']), 'meta')]
    if report.get('score') and not diagnostic:
        score=report['score']
        story.append(p(f"综合评分 {score['overallScore']:g} · 置信度 {score['confidence']:g}% · 排名样本 {report['rankSamples']}", 'meta'))
    if data.get('comparison'):
        c=data['comparison']
        story.append(p(f"与基线评分变化：{c['delta']:+g}" if c.get('comparable') else plain(c.get('reason')), 'meta'))
    if not samples:
        story.append(p('没有有效回答，暂不能计算指标。', 'meta'))
    story += [p('监测模型', 'section')]
    for m in data['models']:
        story.append(p(plain(m['name']) + ' · ' + plain(m['code']) + ' · 版本 ' + plain(m['revision'])))
    if report.get('competitors'):
        story.append(p('竞品提及' if diagnostic else '竞品提及率', 'section'))
        rows = [[p('品牌','label'),p('提及样本' if diagnostic else '提及率','label')]]
        rows += [[p(c['name']),p(sample_value(c['mentionRate'], c.get('mentions')))] for c in report['competitors']]
        story.append(table(rows,[WIDTH*.75,WIDTH*.25],True))
    if report.get('citations'):
        story.append(p('引用排行', 'section'))
        for i,c in enumerate(report['citations'],1):
            story.append(rich(f"{i}. " + safe_link(c['url'], c.get('title') or c['url']) + ' · ' + markup(c['count']) + ' 次'))
    story.append(p('回答证据', 'section'))
    for run in data['runs']:
        story.append(p(run['question'], 'question'))
        story.append(p(plain(run['model']) + ' · ' + STATES.get(run['status'], '未完成') + ' · ' + money(run['cost']), 'meta'))
        if run.get('error'):
            story.append(p(run['error'], 'meta'))
        answer=plain(run['text']) if run.get('text') else '暂无回答'
        # Separate paragraphs allow long answers to paginate without a giant table cell.
        for block in re.split(r'\n\s*\n', answer):
            if block.strip():
                story.append(p(block))
        for c in run['citations']:
            story.append(rich(safe_link(c['url'], c.get('title') or c['url']), 'meta'))
    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, topMargin=54, bottomMargin=46,
                            leftMargin=MARGIN, rightMargin=MARGIN, title=title, author='知行方舟', pageCompression=1)
    def page(canvas, _doc):
        canvas.saveState()
        canvas.setFillColor(BRAND)
        canvas.rect(MARGIN, PAGE_HEIGHT-33, 22, 2, stroke=0, fill=1)
        canvas.setFont(FONT, 9)
        canvas.drawString(MARGIN+31, PAGE_HEIGHT-36, '知行方舟 / GEO')
        canvas.setStrokeColor(LINE)
        canvas.line(MARGIN, 36, PAGE_WIDTH-MARGIN, 36)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(PAGE_WIDTH-MARGIN, 22, f'第 {canvas.getPageNumber()} 页')
        canvas.restoreState()
    doc.build(story, onFirstPage=page, onLaterPages=page)
    return out.getvalue()


if __name__ == '__main__':
    sys.stdout.buffer.write(render(json.load(sys.stdin)))
