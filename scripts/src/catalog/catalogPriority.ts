import type { EvidenceTier } from "./tfda188.js";

export type EnrichmentLane = "ai_extract" | "human_verify" | "source_needed";

export interface CatalogPriorityInput {
  evidenceTier: EvidenceTier;
  scanCount: number;
  submissionCount: number;
  imageCount: number;
  hasNutrition: boolean;
  hasIngredients: boolean;
  daysSinceUpdate: number;
}
export interface CatalogPriorityResult {
  score: number;
  lane: EnrichmentLane;
  reasons: string[];
}

/**
 * Rank the next useful unit of catalog work. Demand has the largest weight,
 * but evidence closeness prevents the queue from spending all its time on
 * popular records that have no usable source material.
 */
export function calculateCatalogPriority(input: CatalogPriorityInput): CatalogPriorityResult {
  const demandScore = Math.min(Math.max(input.scanCount, 0), 25) * 12
    + Math.min(Math.max(input.submissionCount, 0), 10) * 30;
  const evidenceScore: Record<EvidenceTier, number> = {
    review_ready: 180,
    nutrition_ready: 120,
    ingredients_ready: 90,
    catalog_only: 0,
  };
  const imageScore = Math.min(Math.max(input.imageCount, 0), 3) * 25;
  const freshnessScore = Math.max(0, 30 - Math.min(Math.max(input.daysSinceUpdate, 0), 30));
  const score = Math.round(demandScore + evidenceScore[input.evidenceTier] + imageScore + freshnessScore);

  const lane: EnrichmentLane = input.imageCount > 0 && (!input.hasNutrition || !input.hasIngredients)
    ? "ai_extract"
    : input.hasNutrition || input.hasIngredients
      ? "human_verify"
      : "source_needed";
  const reasons = [
    input.scanCount > 0 ? `${input.scanCount} 次實際掃描需求` : null,
    input.submissionCount > 0 ? `${input.submissionCount} 次使用者補件` : null,
    input.evidenceTier === "review_ready" ? "成分與營養皆已具備，最接近可核對" : null,
    lane === "ai_extract" ? "已有包裝圖片，可由 AI 補欄位" : null,
    lane === "source_needed" ? "缺少可讀標示，應優先向品牌或使用者取得照片" : null,
  ].filter((value): value is string => Boolean(value));

  return { score, lane, reasons };
}
