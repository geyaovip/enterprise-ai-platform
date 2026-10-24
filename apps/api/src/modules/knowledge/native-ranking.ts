/** Bounded lexical signals. Chinese bigrams also work without a segmentation service. */
export function queryTerms(query: string): Array<{ text: string; weight: number }> {
  const terms = new Map<string, number>();
  for (const part of query.normalize('NFKC').toLowerCase().match(/[a-z0-9][a-z0-9_.-]*|[\u3400-\u9fff]+/g) ?? []) {
    if (/^[a-z0-9]/.test(part)) terms.set(part, /[0-9]/.test(part) ? 4 : 2);
    else {
      if (part.length <= 12 && part.length > 1) terms.set(part, 2);
      for (let i = 0; i < part.length - 1; i++) {
        const term = part.slice(i, i + 2);
        if (!['的是', '是什么', '什么', '如何', '怎么', '是否', '可以', '一下', '我们', '这个', '有关', '请问'].includes(term)) terms.set(term, 1);
      }
    }
  }
  return [...terms].slice(0, 32).map(([text, weight]) => ({ text, weight }));
}
export type RankedRow = { datasetId: string; documentId: string; ordinal: number; text: string; locator: Record<string, unknown>; distance: number | null; lexical: number; dimension: number };
export function hybridCandidates(rows: RankedRow[], query: string): RankedRow[] {
  const key = (row: RankedRow) => `${row.datasetId}:${row.ordinal}`;
  const scores = new Map<string, number>();
  const add = (row: RankedRow, rank: number) => scores.set(key(row), (scores.get(key(row)) ?? 0) + 1 / (60 + rank));
  rows.filter(r => r.distance !== null && r.distance <= 0.8).sort((a, b) => a.distance! - b.distance! || key(a).localeCompare(key(b))).slice(0, 32).forEach((r, i) => add(r, i + 1));
  rows.filter(r => r.lexical > 0).sort((a, b) => b.lexical - a.lexical || key(a).localeCompare(key(b))).slice(0, 32).forEach((r, i) => add(r, i + 1));
  return rows.filter(r => scores.has(key(r))).sort((a, b) => scores.get(key(b))! - scores.get(key(a))! || key(a).localeCompare(key(b))).slice(0, 32);
}
/** A small deterministic reranker, explicitly not a neural cross encoder. */
export function localRerank<T extends { text: string }>(rows: T[], query: string): T[] {
  const terms = queryTerms(query), total = terms.reduce((n, term) => n + term.weight, 0) || 1;
  const compact = query.normalize('NFKC').trim().toLowerCase();
  return rows.map((row, index) => {
    const text = row.text.normalize('NFKC').toLowerCase();
    const coverage = terms.reduce((n, term) => n + (text.includes(term.text) ? term.weight : 0), 0) / total;
    const phrase = compact.length > 1 && text.includes(compact) ? 0.3 : 0;
    return { row, index, score: coverage + phrase + 0.15 * (rows.length - index) / Math.max(1, rows.length) };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(x => x.row);
}
