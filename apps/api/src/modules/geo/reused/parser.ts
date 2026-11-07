// Copied from yingchuan-formal-ui f52ca56 (read-only source), 2026-11-07.
export const PARSER_VERSION = "parser-v1";

export interface ParsedMention {
  readonly confidence: number;
  readonly evidenceSnippet: string;
  readonly kind: "target" | "competitor";
  readonly name: string;
  readonly rank?: number;
  readonly rankInferred: boolean;
  readonly recommended: boolean;
}

export interface ParsedResponse {
  readonly averageConfidence: number;
  readonly factClaims: readonly ParsedFactClaim[];
  readonly mentions: readonly ParsedMention[];
  readonly refused: boolean;
  readonly sentimentLabel: "negative" | "neutral" | "positive";
  readonly sentimentScore: number;
  readonly validSample: boolean;
}

export interface ParsedFactClaim {
  readonly claimText: string;
  readonly confidence: number;
  readonly evidenceSnippet: string;
  readonly subject: string;
}

export function normalizeEntityName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/(?:品牌|公司)$/u, "");
}

export function parseResponse(
  text: string,
  targetNames: readonly string[],
): ParsedResponse {
  const clean = text.trim();
  const refused = /(?:无法回答|不能回答|抱歉|无法提供)/u.test(clean);
  if (!clean)
    return {
      averageConfidence: 0,
      factClaims: [],
      mentions: [],
      refused: false,
      sentimentLabel: "neutral",
      sentimentScore: 0,
      validSample: false,
    };
  const target = targetNames.find((name) =>
    clean.toLocaleLowerCase("zh-CN").includes(name.toLocaleLowerCase("zh-CN")),
  );
  const recommendation = /(?:推荐|值得|首选|建议|优先考虑)/u.test(clean);
  const lines = clean
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const rankFor = (name: string) => {
    const index = lines.findIndex((line) => line.includes(name));
    if (index < 0) return undefined;
    const explicit = lines[index]?.match(/^\s*(?:第\s*)?(\d+)[.、)]/u)?.[1];
    return explicit
      ? Number(explicit)
      : lines.length > 1
        ? index + 1
        : undefined;
  };
  const mentions: ParsedMention[] = [];
  if (target) {
    const rank = rankFor(target);
    mentions.push({
      confidence: 98,
      evidenceSnippet: snippet(clean, target),
      kind: "target",
      name: target,
      rank: rank ?? (recommendation ? 1 : undefined),
      rankInferred: rank === undefined && recommendation,
      recommended: recommendation,
    });
  }
  const candidates = lines.flatMap((line) => {
    const value = line.replace(/^\s*(?:第\s*)?\d+[.、)]\s*/u, "");
    const match = value.match(
      /^([\p{Script=Han}A-Za-z0-9·&-]{2,30})(?:品牌|：|:|\s|，|,)/u,
    );
    return match?.[1] ? [match[1]] : [];
  });
  const targetNormalized = new Set(targetNames.map(normalizeEntityName));
  for (const name of [...new Set(candidates)]) {
    if (targetNormalized.has(normalizeEntityName(name))) continue;
    mentions.push({
      confidence: 82,
      evidenceSnippet: snippet(clean, name),
      kind: "competitor",
      name,
      rank: rankFor(name),
      rankInferred: false,
      recommended: recommendation,
    });
  }
  const positive = (
    clean.match(/(?:推荐|值得|优秀|领先|可靠|便捷|满意)/gu) ?? []
  ).length;
  const negative = (
    clean.match(/(?:不推荐|较差|不足|风险|投诉|失望|不可靠)/gu) ?? []
  ).length;
  const sentimentScore = Math.max(
    -100,
    Math.min(100, (positive - negative) * 25),
  );
  const factClaims = lines
    .filter((line) => targetNames.some((name) => line.includes(name)))
    .filter((line) =>
      /(?:是|位于|成立|提供|拥有|覆盖|支持|价格|门店|服务)/u.test(line),
    )
    .map((line) => ({
      claimText: line.slice(0, 1000),
      confidence: 75,
      evidenceSnippet: line.slice(0, 1000),
      subject:
        targetNames.find((name) => line.includes(name)) ??
        targetNames[0] ??
        "unknown",
    }));
  return {
    averageConfidence:
      mentions.length > 0
        ? mentions.reduce((sum, item) => sum + item.confidence, 0) /
          mentions.length
        : refused
          ? 95
          : 70,
    mentions,
    refused,
    factClaims,
    sentimentLabel:
      sentimentScore > 0
        ? "positive"
        : sentimentScore < 0
          ? "negative"
          : "neutral",
    sentimentScore,
    validSample: true,
  };
}

function snippet(text: string, term: string): string {
  const index = text.indexOf(term);
  return text.slice(
    Math.max(0, index - 100),
    Math.min(text.length, index + term.length + 100),
  );
}
