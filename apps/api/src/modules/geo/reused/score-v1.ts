// Copied from yingchuan-formal-ui f52ca56 (read-only source), 2026-11-07.
import { createHash } from "node:crypto";

export const SCORE_VERSION = "score-v1";

export interface ScoreSample {
  readonly competitors: readonly {
    readonly name: string;
    readonly rank?: number;
  }[];
  readonly modelId: string;
  readonly parseConfidence: number;
  readonly promptId: string;
  readonly rank?: number;
  readonly recommended: boolean;
  readonly targetMentioned: boolean;
}

export interface DimensionResult {
  readonly code: string;
  readonly confidence: number;
  readonly effectiveWeight: number;
  readonly missingReason?: string;
  readonly originalWeight: number;
  readonly sampleSize: number;
  readonly value?: number;
}

const weights = {
  mention_rate: 0.2,
  recommendation_rate: 0.2,
  ranking_strength: 0.15,
  factual_accuracy: 0.15,
  model_coverage: 0.1,
  prompt_coverage: 0.1,
  consistency: 0.05,
  competitive_position: 0.05,
} as const;

export function calculateScoreV1(input: {
  readonly eligibleModelIds: readonly string[];
  readonly plannedPromptIds: readonly string[];
  readonly plannedRunCount: number;
  readonly samples: readonly ScoreSample[];
}) {
  const samples = input.samples;
  const percent = (count: number, total: number) =>
    total ? (count / total) * 100 : 0;
  const rankPoints = (rank?: number) =>
    rank === 1 ? 100 : rank === 2 ? 75 : rank === 3 ? 50 : rank === 4 ? 25 : 0;
  const mentioned = samples.filter((item) => item.targetMentioned).length;
  const recommended = samples.filter((item) => item.recommended).length;
  const validModels = new Set(samples.map((item) => item.modelId));
  const validPrompts = new Set(samples.map((item) => item.promptId));
  const targetPoints = samples.reduce(
    (sum, item) => sum + (item.recommended ? rankPoints(item.rank) : 0),
    0,
  );
  const competitorPoints = new Map<string, number>();
  for (const sample of samples)
    for (const competitor of sample.competitors)
      competitorPoints.set(
        competitor.name,
        (competitorPoints.get(competitor.name) ?? 0) +
          rankPoints(competitor.rank),
      );
  const modelRates = [...validModels].map((modelId) => {
    const modelSamples = samples.filter((item) => item.modelId === modelId);
    return {
      mention: percent(
        modelSamples.filter((item) => item.targetMentioned).length,
        modelSamples.length,
      ),
      recommendation: percent(
        modelSamples.filter((item) => item.recommended).length,
        modelSamples.length,
      ),
    };
  });
  const consistency =
    modelRates.length < 2
      ? undefined
      : ((100 - pairwise(modelRates)) *
          Math.max(
            percent(mentioned, samples.length),
            percent(recommended, samples.length),
          )) /
        100;
  const values: Record<keyof typeof weights, number | undefined> = {
    mention_rate: percent(mentioned, samples.length),
    recommendation_rate: percent(recommended, samples.length),
    ranking_strength: samples.length
      ? samples.reduce((sum, item) => sum + rankPoints(item.rank), 0) /
        samples.length
      : 0,
    factual_accuracy: undefined,
    model_coverage: percent(validModels.size, input.eligibleModelIds.length),
    prompt_coverage: percent(validPrompts.size, input.plannedPromptIds.length),
    consistency,
    competitive_position:
      targetPoints === 0
        ? 0
        : Math.min(
            100,
            (targetPoints /
              Math.max(targetPoints, ...competitorPoints.values(), 0)) *
              100,
          ),
  };
  const availableWeight = Object.entries(weights).reduce(
    (sum, [code, weight]) =>
      sum + (values[code as keyof typeof weights] === undefined ? 0 : weight),
    0,
  );
  const averageParse = samples.length
    ? samples.reduce((sum, item) => sum + item.parseConfidence, 0) /
      samples.length
    : 0;
  const confidenceRaw =
    Math.min(samples.length / 40, 1) * 40 +
    Math.min(samples.length / Math.max(input.plannedRunCount, 1), 1) * 30 +
    (averageParse / 100) * 30;
  const diagnosticOnly =
    samples.length < 20 || validPrompts.size < 5 || validModels.size < 2;
  const confidence = round(
    diagnosticOnly ? Math.min(confidenceRaw, 49) : confidenceRaw,
  );
  const dimensions: DimensionResult[] = Object.entries(weights).map(
    ([code, weight]) => {
      const value = values[code as keyof typeof weights];
      return {
        code,
        confidence,
        effectiveWeight: value === undefined ? 0 : weight / availableWeight,
        ...(value === undefined
          ? {
              missingReason:
                code === "factual_accuracy"
                  ? "NO_VERIFIED_FACTS"
                  : "INSUFFICIENT_MODELS",
            }
          : {}),
        originalWeight: weight,
        sampleSize: samples.length,
        value: value === undefined ? undefined : round(value),
      };
    },
  );
  const overallScore = round(
    dimensions.reduce(
      (sum, item) => sum + (item.value ?? 0) * item.effectiveWeight,
      0,
    ),
  );
  return {
    comparabilityHash: createHash("sha256")
      .update(
        JSON.stringify({
          models: [...input.eligibleModelIds].sort(),
          prompts: [...input.plannedPromptIds].sort(),
          scoreVersion: SCORE_VERSION,
        }),
      )
      .digest("hex"),
    confidence,
    confidenceLevel:
      confidence >= 75 ? "high" : confidence >= 50 ? "medium" : "low",
    diagnosticOnly,
    dimensions,
    overallScore,
    validModelCount: validModels.size,
    validPromptCount: validPrompts.size,
    validSampleCount: samples.length,
  };
}

function pairwise(
  values: readonly { mention: number; recommendation: number }[],
) {
  const differences: number[] = [];
  for (let left = 0; left < values.length; left += 1)
    for (let right = left + 1; right < values.length; right += 1)
      differences.push(
        (Math.abs(values[left]!.mention - values[right]!.mention) +
          Math.abs(
            values[left]!.recommendation - values[right]!.recommendation,
          )) /
          2,
      );
  return (
    differences.reduce((sum, value) => sum + value, 0) / differences.length
  );
}

function round(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
}
