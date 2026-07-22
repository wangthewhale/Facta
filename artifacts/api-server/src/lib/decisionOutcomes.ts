export type DecisionRecommendationCode =
  "buy" | "limit" | "swap" | "complete_data";

export type DecisionOutcomeCode =
  | "bought"
  | "skipped"
  | "limited"
  | "kept"
  | "swapped"
  | "could_not_find"
  | "will_complete_data";

const COMPATIBLE_OUTCOMES: Record<
  DecisionRecommendationCode,
  readonly DecisionOutcomeCode[]
> = {
  buy: ["bought", "skipped"],
  limit: ["limited", "kept", "swapped", "could_not_find"],
  swap: ["swapped", "kept", "could_not_find"],
  complete_data: ["will_complete_data", "skipped"],
};

export interface DecisionCombination {
  productId: number;
  recommendationCode: DecisionRecommendationCode;
  outcomeCode: DecisionOutcomeCode;
  selectedAlternativeProductId?: number | null;
}

/**
 * Keeps the outcome ledger meaningful without letting it affect scoring.
 * Returns a user-safe validation message or null when the combination is valid.
 */
export function validateDecisionCombination(
  decision: DecisionCombination,
): string | null {
  if (
    !COMPATIBLE_OUTCOMES[decision.recommendationCode].includes(
      decision.outcomeCode,
    )
  ) {
    return "This outcome does not match the recommendation that was shown";
  }

  const alternativeId = decision.selectedAlternativeProductId ?? null;
  if (decision.outcomeCode === "swapped") {
    if (!alternativeId) {
      return "A swapped outcome requires the selected alternative product";
    }
    if (alternativeId === decision.productId) {
      return "The replacement must be a different product";
    }
  } else if (alternativeId) {
    return "An alternative product can only be stored for a swapped outcome";
  }

  return null;
}
