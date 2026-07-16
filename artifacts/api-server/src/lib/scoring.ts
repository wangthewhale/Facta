/**
 * FACTA Deterministic Scoring Engine v1.0.0
 *
 * All scores are calculated from structured rules — no AI free-form scoring.
 * Same input + same ruleset version = same output, always.
 */

export const RULESET_VERSION = "1.0.0";

interface NutritionInput {
  calories?: number | null;
  totalFat?: number | null;
  saturatedFat?: number | null;
  transFat?: number | null;
  sodium?: number | null;
  totalCarbs?: number | null;
  dietaryFiber?: number | null;
  totalSugars?: number | null;
  protein?: number | null;
}

interface IngredientInput {
  name: string;
  riskLevel?: string | null;
  isAdditive?: string | null;
  evidenceStrength?: string | null;
  riskReason?: string | null;
}

interface ScoringInput {
  nutrition?: NutritionInput | null;
  ingredients?: IngredientInput[];
  dataCompleteness: number; // 0-1
}

export interface ScoringReason {
  label: string;
  labelZh: string;
  impact: "positive" | "negative" | "neutral";
  evidenceStrength: string;
  source: string;
}

export interface AdditiveFlag {
  name: string;
  nameZh?: string;
  riskLevel: string;
  reason?: string;
  evidenceStrength: string;
}

export interface ScoringResult {
  overallScore: number;
  nutritionScore: number | null;
  additiveScore: number | null;
  scoreGrade: "Excellent" | "Good" | "Consider" | "Poor";
  verdict: string;
  verdictZh: string;
  topReasons: ScoringReason[];
  additiveFlags: AdditiveFlag[];
  evidenceConfidence: "high" | "medium" | "low";
  rulesetVersion: string;
}

/** Per-100g thresholds (TW dietary guidelines + WHO) */
const NUTRITION_RULES = {
  sodium: {
    low: 120,    // mg — good
    high: 600,   // mg — concern
    critical: 1200, // mg — avoid
  },
  totalSugars: {
    low: 5,      // g — good
    high: 15,    // g — concern
    critical: 25, // g — avoid
  },
  saturatedFat: {
    low: 1.5,    // g — good
    high: 5,     // g — concern
    critical: 10, // g — avoid
  },
  transFat: {
    any: 0.5,   // g — if present, penalize heavily
  },
  dietaryFiber: {
    good: 3,     // g — bonus
    excellent: 6, // g — bigger bonus
  },
  protein: {
    good: 5,     // g — bonus
  },
};

function scoreNutrition(n: NutritionInput): { score: number; reasons: ScoringReason[] } {
  let score = 70; // neutral baseline
  const reasons: ScoringReason[] = [];

  // Sodium
  if (n.sodium != null) {
    if (n.sodium <= NUTRITION_RULES.sodium.low) {
      score += 8;
      reasons.push({ label: "Low sodium", labelZh: "低鈉", impact: "positive", evidenceStrength: "high", source: "TW Dietary Guidelines" });
    } else if (n.sodium >= NUTRITION_RULES.sodium.critical) {
      score -= 20;
      reasons.push({ label: "Very high sodium", labelZh: "鈉含量極高", impact: "negative", evidenceStrength: "high", source: "WHO Salt Reduction" });
    } else if (n.sodium >= NUTRITION_RULES.sodium.high) {
      score -= 10;
      reasons.push({ label: "High sodium", labelZh: "高鈉", impact: "negative", evidenceStrength: "high", source: "TW Dietary Guidelines" });
    }
  }

  // Sugars
  if (n.totalSugars != null) {
    if (n.totalSugars <= NUTRITION_RULES.totalSugars.low) {
      score += 6;
      reasons.push({ label: "Low added sugars", labelZh: "低糖", impact: "positive", evidenceStrength: "high", source: "WHO Sugar Guidelines" });
    } else if (n.totalSugars >= NUTRITION_RULES.totalSugars.critical) {
      score -= 18;
      reasons.push({ label: "Very high sugars", labelZh: "糖分極高", impact: "negative", evidenceStrength: "high", source: "WHO Sugar Guidelines" });
    } else if (n.totalSugars >= NUTRITION_RULES.totalSugars.high) {
      score -= 10;
      reasons.push({ label: "High sugars", labelZh: "高糖", impact: "negative", evidenceStrength: "high", source: "WHO Sugar Guidelines" });
    }
  }

  // Saturated fat
  if (n.saturatedFat != null) {
    if (n.saturatedFat >= NUTRITION_RULES.saturatedFat.critical) {
      score -= 15;
      reasons.push({ label: "Very high saturated fat", labelZh: "飽和脂肪極高", impact: "negative", evidenceStrength: "high", source: "WHO Fat Guidelines" });
    } else if (n.saturatedFat >= NUTRITION_RULES.saturatedFat.high) {
      score -= 8;
      reasons.push({ label: "High saturated fat", labelZh: "飽和脂肪高", impact: "negative", evidenceStrength: "high", source: "WHO Fat Guidelines" });
    }
  }

  // Trans fat
  if (n.transFat != null && n.transFat >= NUTRITION_RULES.transFat.any) {
    score -= 20;
    reasons.push({ label: "Contains trans fat", labelZh: "含有反式脂肪", impact: "negative", evidenceStrength: "high", source: "WHO Trans Fat Elimination" });
  }

  // Fiber bonus
  if (n.dietaryFiber != null) {
    if (n.dietaryFiber >= NUTRITION_RULES.dietaryFiber.excellent) {
      score += 10;
      reasons.push({ label: "Excellent dietary fiber", labelZh: "膳食纖維充足", impact: "positive", evidenceStrength: "high", source: "TW Dietary Guidelines" });
    } else if (n.dietaryFiber >= NUTRITION_RULES.dietaryFiber.good) {
      score += 5;
      reasons.push({ label: "Good dietary fiber", labelZh: "含有膳食纖維", impact: "positive", evidenceStrength: "medium", source: "TW Dietary Guidelines" });
    }
  }

  // Protein bonus
  if (n.protein != null && n.protein >= NUTRITION_RULES.protein.good) {
    score += 5;
    reasons.push({ label: "Good protein content", labelZh: "蛋白質含量佳", impact: "positive", evidenceStrength: "medium", source: "TW Dietary Guidelines" });
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function scoreAdditives(ingredients: IngredientInput[]): { score: number; reasons: ScoringReason[]; flags: AdditiveFlag[] } {
  let score = 85; // start high, deduct for bad additives
  const reasons: ScoringReason[] = [];
  const flags: AdditiveFlag[] = [];

  const avoidIngredients = ingredients.filter(i => i.riskLevel === "avoid");
  const cautionIngredients = ingredients.filter(i => i.riskLevel === "caution");

  for (const ing of avoidIngredients) {
    score -= 15;
    flags.push({
      name: ing.name,
      riskLevel: "avoid",
      reason: ing.riskReason ?? "Flagged by regulatory evidence",
      evidenceStrength: ing.evidenceStrength ?? "medium",
    });
  }

  for (const ing of cautionIngredients) {
    score -= 5;
    flags.push({
      name: ing.name,
      riskLevel: "caution",
      reason: ing.riskReason ?? "Use in moderation",
      evidenceStrength: ing.evidenceStrength ?? "medium",
    });
  }

  if (avoidIngredients.length > 0) {
    reasons.push({
      label: `Contains ${avoidIngredients.length} flagged additive(s)`,
      labelZh: `含有 ${avoidIngredients.length} 種需注意的添加物`,
      impact: "negative",
      evidenceStrength: "medium",
      source: "FACTA Ingredient Database",
    });
  }

  if (avoidIngredients.length === 0 && cautionIngredients.length === 0) {
    reasons.push({
      label: "No high-risk additives detected",
      labelZh: "未檢測到高風險添加物",
      impact: "positive",
      evidenceStrength: "medium",
      source: "FACTA Ingredient Database",
    });
  }

  return { score: Math.max(0, Math.min(100, score)), reasons, flags };
}

function gradeFromScore(score: number): "Excellent" | "Good" | "Consider" | "Poor" {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Consider";
  return "Poor";
}

function verdictFromGrade(grade: string): { verdict: string; verdictZh: string } {
  switch (grade) {
    case "Excellent":
      return { verdict: "A strong choice with solid nutritional credentials.", verdictZh: "整體表現優秀，是值得信賴的選擇。" };
    case "Good":
      return { verdict: "A decent option — no major red flags, but room to improve.", verdictZh: "整體尚可，無重大問題，但仍有改善空間。" };
    case "Consider":
      return { verdict: "Some concerns worth knowing before you buy.", verdictZh: "有些值得注意的問題，購買前請參考詳細說明。" };
    case "Poor":
      return { verdict: "Notable concerns — consider the alternatives.", verdictZh: "有明顯問題，建議參考替代選項。" };
    default:
      return { verdict: "Analysis complete.", verdictZh: "分析完成。" };
  }
}

export function calculateScore(input: ScoringInput): ScoringResult {
  const allReasons: ScoringReason[] = [];
  let nutritionScore: number | null = null;
  let additiveScore: number | null = null;
  let allFlags: AdditiveFlag[] = [];

  // Nutrition scoring
  if (input.nutrition) {
    const { score, reasons } = scoreNutrition(input.nutrition);
    nutritionScore = score;
    allReasons.push(...reasons);
  }

  // Additive scoring
  if (input.ingredients && input.ingredients.length > 0) {
    const { score, reasons, flags } = scoreAdditives(input.ingredients);
    additiveScore = score;
    allReasons.push(...reasons);
    allFlags = flags;
  }

  // Combine scores
  let overallScore: number;
  if (nutritionScore !== null && additiveScore !== null) {
    overallScore = Math.round(nutritionScore * 0.6 + additiveScore * 0.4);
  } else if (nutritionScore !== null) {
    overallScore = nutritionScore;
  } else if (additiveScore !== null) {
    overallScore = additiveScore;
  } else {
    overallScore = 50; // unknown
  }

  // Apply completeness penalty
  if (input.dataCompleteness < 0.5) {
    overallScore = Math.round(overallScore * 0.9);
  }

  overallScore = Math.max(0, Math.min(100, overallScore));

  const scoreGrade = gradeFromScore(overallScore);
  const { verdict, verdictZh } = verdictFromGrade(scoreGrade);

  const evidenceConfidence: "high" | "medium" | "low" =
    input.dataCompleteness >= 0.8 ? "high" :
    input.dataCompleteness >= 0.5 ? "medium" : "low";

  // Top reasons: sort by impact (negative first, then positive)
  const topReasons = allReasons
    .sort((a, b) => (a.impact === "negative" ? -1 : 1) - (b.impact === "negative" ? -1 : 1))
    .slice(0, 5);

  return {
    overallScore,
    nutritionScore,
    additiveScore,
    scoreGrade,
    verdict,
    verdictZh,
    topReasons,
    additiveFlags: allFlags,
    evidenceConfidence,
    rulesetVersion: RULESET_VERSION,
  };
}
