import {
  parseResponse,
  PARSER_VERSION as LEGACY_PARSER_VERSION,
} from "./reused/parser";
import {
  calculateScoreV1,
  SCORE_VERSION,
  type ScoreSample,
} from "./reused/score-v1";
import type { FrozenInput } from "./geo.rules";
export const GEO_PARSER_VERSION = "geo-evidence-v2";
export const GEO_SAMPLE_SOURCE = "模型 API 抽样 · 不代表消费端 App 排名";

const numbered = /^\s*(?:[-*]\s*)?(\d{1,3})[.、)）]\s*/u;
const rankedHeading =
  /^(?:(?:以下|给出|我的)\s*)?(?:推荐排名|推荐榜单|推荐顺序|排名|榜单)\s*[:：]\s*$/u;
const recommendationBefore =
  /(?:优先考虑|首选|推荐|建议(?:选择|购买|优先考虑)?)[\s:：*「“]*$/u;
const recommendationAfter =
  /^[\s*」”]*(?:是(?:我的|值得考虑的)?(?:首选|推荐选项)|值得(?:购买|考虑|推荐)|优先推荐)/u;
const negative =
  /(?:不\s*(?:太|再|一定|怎么|宜|适合|推荐|建议|值得|应|能|是首选|作为)|仅(?:作|是|为)|避免|排除)/u;
const quotedOther = /(?:常被|曾被|有人|网上|据称|曾经|过去|是否|所谓)\s*$/u;

function entityPattern(name: string) {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    (/^[a-z0-9]/iu.test(name) ? "(?<![a-z0-9])" : "") +
      literal +
      (/[a-z0-9]$/iu.test(name) ? "(?![a-z0-9])" : ""),
    "iu",
  );
}

function assessEntity(text: string, names: string[]) {
  const patterns = names.filter(Boolean).map(entityPattern);
  let mention: string | undefined, recommendation: string | undefined;
  let ranking: { rank: number; excerpt: string } | undefined;
  const lines = text.split(/\n/u);
  const listSize = lines.filter((line) => numbered.test(line)).length;
  let inRankedList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (rankedHeading.test(line.replace(/^[#*\s]+/u, ""))) {
      inRankedList = true;
      continue;
    }
    const item = line.match(numbered);
    if (!item) inRankedList = false;
    const content = item ? line.slice(item[0].length) : line;
    const clauses = content.split(/[。！？!?；;，,\u3001]/u);
    for (let index = 0; index < clauses.length; index++) {
      const clause = clauses[index]!;
      const match = patterns
        .map((pattern) => clause.match(pattern))
        .find(Boolean);
      if (match?.index === undefined) continue;
      const before = clause.slice(0, match.index),
        after = clause.slice(match.index + match[0].length);
      const excerpt = line.slice(0, 320);
      mention ??= excerpt;
      const qualifier = clauses[index + 1] ?? "";
      const disqualified =
        negative.test(clause) ||
        (/^(?:\s*(?:但|不过|然而|只是))/.test(qualifier) &&
          negative.test(qualifier));
      if (disqualified) continue;
      const prefix = before.match(recommendationBefore);
      const direct =
        Boolean(
          prefix && !quotedOther.test(before.slice(0, prefix.index).trim()),
        ) || recommendationAfter.test(after);
      if (direct) recommendation ??= excerpt;
      const explicit =
        before.match(
          /(?:第\s*(\d{1,3})\s*名|Top\s*(\d{1,3}))\s*[:：*]*\s*$/iu,
        ) ??
        after.match(
          /^\s*(?:[（(]\s*)?(?:(?:排名|位列)\s*)?第\s*(\d{1,3})\s*名/u,
        );
      const leading = index === 0 && /^\s*[*「“]*\s*$/u.test(before);
      const rank = Number(
        explicit?.[1] ??
          explicit?.[2] ??
          (item &&
          index === 0 &&
          ((direct && listSize >= 2) || (inRankedList && leading))
            ? item[1]
            : 0),
      );
      if (rank > 0 && !ranking) ranking = { rank, excerpt };
    }
  }
  return { mention, recommendation, ranking };
}

export function parseGeoAnswer(
  text: string,
  s: FrozenInput,
  truncated = false,
) {
  if (s.parserVersion === LEGACY_PARSER_VERSION)
    return parseLegacyAnswer(text, s, truncated);
  const names = [s.brandName, ...s.aliases];
  const parsed = parseResponse(text, names);
  const evidence = assessEntity(text, names);
  const validSample = parsed.validSample && !parsed.refused && !truncated;
  return {
    ...parsed,
    validSample,
    evidence,
    mentions: parsed.mentions.flatMap((mention) => {
      if (mention.kind !== "target") return [mention];
      if (!evidence.mention) return [];
      return [
        {
          ...mention,
          evidenceSnippet: evidence.mention,
          rank: evidence.ranking?.rank,
          rankInferred: false,
          recommended: Boolean(evidence.recommendation),
        },
      ];
    }),
  };
}

function parseLegacyAnswer(text: string, s: FrozenInput, truncated = false) {
  const p = parseResponse(text, [s.brandName, ...s.aliases]);
  // GEO ranking requires an explicit numbered list. A mention or recommendation cannot imply rank 1.
  const names = [s.brandName, ...s.aliases];
  const lines = text.split(/\n+/),
    line = lines.find((l) =>
      names.some((n) => l.toLocaleLowerCase().includes(n.toLocaleLowerCase())),
    );
  const rank = line?.match(/^\s*(?:[-*]\s*)?(?:第\s*)?(\d+)[.、)）]/u)?.[1];
  const recommended =
    !!line &&
    /(?:推荐|值得|首选|建议|优先考虑)/u.test(line) &&
    !/(?:不推荐|不建议|不值得|不应|避免)/u.test(line);
  return {
    ...p,
    validSample: p.validSample && !p.refused && !truncated,
    mentions: p.mentions.map((m) =>
      m.kind === "target"
        ? {
            ...m,
            rank: rank ? Number(rank) : undefined,
            rankInferred: false,
            recommended,
          }
        : m,
    ),
  };
}
export function citationUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}
export function reportFor(snapshot: FrozenInput, runs: any[]) {
  const valid = runs.filter(
    (r) => r.status === "succeeded" && r.validSample && r.parsed,
  );
  const samples: ScoreSample[] = valid.map((r) => {
    const target = r.parsed.mentions?.find((m: any) => m.kind === "target");
    return {
      modelId: r.modelVersionId,
      promptId: r.questionId,
      parseConfidence: r.parsed.averageConfidence,
      rank: target?.rank,
      recommended: target?.recommended ?? false,
      targetMentioned: !!target,
      competitors: snapshot.competitors.map((name) => {
        if (snapshot.parserVersion !== LEGACY_PARSER_VERSION) {
          return { name, rank: assessEntity(r.text, [name]).ranking?.rank };
        }
        const line = (r.text as string)
          .split(/\n+/)
          .find((l) => l.toLowerCase().includes(name.toLowerCase()));
        const rank = line?.match(/^\s*(?:[-*]\s*)?(\d+)[.、)）]/u)?.[1];
        return { name, rank: rank ? Number(rank) : undefined };
      }),
    };
  });
  const score = calculateScoreV1({
    eligibleModelIds: snapshot.models.map((m) => m.versionId),
    plannedPromptIds: snapshot.questions.map((q) => q.id),
    plannedRunCount: runs.length,
    samples,
  });
  const mentioned = samples.filter((s) => s.targetMentioned).length,
    recommended = samples.filter((s) => s.recommended).length,
    ranked = samples.filter((s) => s.rank !== undefined);
  const refs = new Map<
    string,
    { url: string; title: string; count: number; runIds: string[] }
  >();
  for (const r of valid) {
    const seen = new Set<string>();
    for (const c of r.citations ?? []) {
      const url = citationUrl(c.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const row = refs.get(url) ?? {
        url,
        title: typeof c.title === "string" ? c.title : url,
        count: 0,
        runIds: [] as string[],
      };
      row.count++;
      row.runIds.push(r.id);
      refs.set(url, row);
    }
  }
  const domainMap = new Map<string, { domain: string; count: number }>();
  for (const r of valid) {
    const seen = new Set<string>();
    for (const c of r.citations ?? []) {
      const url = citationUrl(c.url);
      if (!url) continue;
      const domain = new URL(url).hostname;
      if (seen.has(domain)) continue;
      seen.add(domain);
      const row = domainMap.get(domain) ?? { domain, count: 0 };
      row.count++;
      domainMap.set(domain, row);
    }
  }
  const opportunities = new Map<
    string,
    {
      questionId: string;
      question: string;
      count: number;
      competitors: Set<string>;
      runId: string;
    }
  >();
  if (
    snapshot.parserVersion === GEO_PARSER_VERSION &&
    snapshot.competitors.length
  ) {
    for (const run of valid) {
      if (
        run.parsed.mentions.some(
          (mention: { kind: string }) => mention.kind === "target",
        )
      )
        continue;
      const names = snapshot.competitors.filter(
        (name) => assessEntity(run.text, [name]).mention,
      );
      if (!names.length) continue;
      const question = snapshot.questions.find(
        (entry) => entry.id === run.questionId,
      );
      if (!question) continue;
      const item = opportunities.get(question.id) ?? {
        questionId: question.id,
        question: question.text,
        count: 0,
        competitors: new Set<string>(),
        runId: run.id,
      };
      item.count++;
      names.forEach((name) => item.competitors.add(name));
      opportunities.set(question.id, item);
    }
  }
  const ratio = (n: number) =>
    samples.length ? Math.round((n / samples.length) * 10000) / 100 : null;
  return {
    parserVersion: snapshot.parserVersion,
    mentionedSamples: mentioned,
    recommendedSamples: recommended,
    scoreVersion: SCORE_VERSION,
    validSamples: samples.length,
    plannedSamples: runs.length,
    mentionRate: ratio(mentioned),
    recommendationRate: ratio(recommended),
    averageRank: ranked.length
      ? ranked.reduce((n, r) => n + r.rank!, 0) / ranked.length
      : null,
    rankSamples: ranked.length,
    score: samples.length ? score : null,
    citations: [...refs.values()].sort((a, b) => b.count - a.count),
    domains: [...domainMap.values()].sort((a, b) => b.count - a.count),
    opportunities: [...opportunities.values()]
      .sort((a, b) => b.count - a.count)
      .map((item) => ({ ...item, competitors: [...item.competitors] })),
    competitors: snapshot.competitors.map((name) => ({
      name,
      mentions: valid.filter((r) =>
        (r.text as string).toLowerCase().includes(name.toLowerCase()),
      ).length,
      mentionRate: ratio(
        valid.filter((r) =>
          (r.text as string).toLowerCase().includes(name.toLowerCase()),
        ).length,
      ),
    })),
    modelBreakdown: snapshot.models.map((m) => {
      const rows = valid.filter((r) => r.modelId === m.id);
      return {
        id: m.id,
        name: m.name,
        samples: rows.length,
        mentionRate: rows.length
          ? (rows.filter((r) =>
              r.parsed.mentions.some((x: any) => x.kind === "target"),
            ).length /
              rows.length) *
            100
          : null,
      };
    }),
    limitation: !samples.length
      ? "没有有效回答，暂不能计算评分。"
      : score.diagnosticOnly
        ? "样本覆盖不足，评分仅用于诊断；API 回答不等同于消费端 App 排名。"
        : "指标来自模型 API 的回答样本，不代表消费端 App 排名。",
  };
}
