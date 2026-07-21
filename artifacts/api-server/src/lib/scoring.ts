/**
 * FACTA deterministic scoring engine v2.
 *
 * Nutrition values are normalized from the labelled serving size to 100 g/ml
 * before applying the 2026 TFDA front-of-pack traffic-light thresholds.
 * Missing evidence changes the scope/confidence of a result; it is never
 * treated as evidence that a product is safe.
 */

export const RULESET_VERSION = "2.0.0";
export const TFDA_FOP_GUIDE_URL = "https://www.fda.gov.tw/tc/newsContent.aspx?cid=4&id=31511";

type FoodForm = "solid" | "liquid";
type TrafficLight = "green" | "yellow" | "red";

export interface NutritionInput {
  servingSize?: number | null;
  servingSizeUnit?: string | null;
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

export interface IngredientInput {
  name: string;
  riskLevel?: string | null;
  isAdditive?: string | null;
  evidenceStrength?: string | null;
  riskReason?: string | null;
}

interface ScoringInput {
  nutrition?: NutritionInput | null;
  ingredients?: IngredientInput[];
  dataCompleteness: number;
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

export type AnalysisScope = "complete" | "nutrition_only" | "ingredients_only" | "insufficient";

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
  analysisScope: AnalysisScope;
  nutritionBasis: "per_100g" | "per_100ml" | null;
  ingredientCoverage: number | null;
  rulesetVersion: string;
}

interface NormalizedNutrition {
  foodForm: FoodForm;
  basis: "per_100g" | "per_100ml";
  values: Omit<NutritionInput, "servingSize" | "servingSizeUnit">;
}

const TFDA_THRESHOLDS = {
  solid: {
    totalSugars: { green: 5, red: 15, unit: "g" },
    sodium: { green: 120, red: 500, unit: "mg" },
    saturatedFat: { green: 1.5, red: 4.5, unit: "g" },
  },
  liquid: {
    totalSugars: { green: 2.5, red: 7.5, unit: "g" },
    sodium: { green: 120, red: 250, unit: "mg" },
    saturatedFat: { green: 0.75, red: 2.25, unit: "g" },
  },
} as const;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeNutritionPer100(input: NutritionInput): NormalizedNutrition | null {
  const servingSize = finiteNumber(input.servingSize);
  const rawUnit = input.servingSizeUnit?.trim().toLowerCase() ?? "";
  if (!servingSize || servingSize <= 0) return null;

  const foodForm: FoodForm | null =
    /^(ml|毫升|毫公升)$/.test(rawUnit) ? "liquid" :
    /^(g|公克|克)$/.test(rawUnit) ? "solid" : null;
  if (!foodForm) return null;

  const factor = 100 / servingSize;
  const keys: Array<keyof Omit<NutritionInput, "servingSize" | "servingSizeUnit">> = [
    "calories", "totalFat", "saturatedFat", "transFat", "sodium",
    "totalCarbs", "dietaryFiber", "totalSugars", "protein",
  ];
  const values: Record<string, number | null> = {};
  for (const key of keys) {
    const value = finiteNumber(input[key]);
    values[key] = value == null ? null : round(value * factor);
  }

  return {
    foodForm,
    basis: foodForm === "liquid" ? "per_100ml" : "per_100g",
    values,
  };
}

function trafficLight(value: number, green: number, red: number): TrafficLight {
  if (value <= green) return "green";
  if (value > red) return "red";
  return "yellow";
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function nutritionReason(
  nutrient: "totalSugars" | "sodium" | "saturatedFat",
  value: number,
  level: TrafficLight,
  basis: "per_100g" | "per_100ml",
  unit: string,
): ScoringReason {
  const names = {
    totalSugars: { en: "Sugar", zh: "糖" },
    sodium: { en: "Sodium", zh: "鈉" },
    saturatedFat: { en: "Saturated fat", zh: "飽和脂肪" },
  }[nutrient];
  const levelLabels = {
    green: { en: "low", zh: "低（綠燈）", impact: "positive" as const },
    yellow: { en: "moderate", zh: "中等（黃燈）", impact: "neutral" as const },
    red: { en: "high", zh: "偏高（紅燈）", impact: "negative" as const },
  }[level];
  const basisLabel = basis === "per_100ml" ? "100 ml" : "100 g";

  return {
    label: `${names.en}: ${formatValue(value)} ${unit}/${basisLabel} (${levelLabels.en})`,
    labelZh: `每 ${basisLabel} ${names.zh} ${formatValue(value)} ${unit}：${levelLabels.zh}`,
    impact: levelLabels.impact,
    evidenceStrength: "high",
    source: TFDA_FOP_GUIDE_URL,
  };
}

function scoreNutrition(input: NutritionInput): {
  score: number | null;
  reasons: ScoringReason[];
  basis: "per_100g" | "per_100ml" | null;
} {
  const normalized = normalizeNutritionPer100(input);
  if (!normalized) {
    return {
      score: null,
      basis: null,
      reasons: [{
        label: "Serving size or unit is missing, so nutrition values cannot be compared fairly.",
        labelZh: "缺少每份量或單位，無法公平換算成每 100g／ml。",
        impact: "neutral",
        evidenceStrength: "high",
        source: TFDA_FOP_GUIDE_URL,
      }],
    };
  }

  const thresholds = TFDA_THRESHOLDS[normalized.foodForm];
  const criticalKeys = ["totalSugars", "sodium", "saturatedFat"] as const;
  const available = criticalKeys.filter(key => normalized.values[key] != null);
  if (available.length < 2) {
    return {
      score: null,
      basis: normalized.basis,
      reasons: [{
        label: "At least two of sugar, sodium and saturated fat are required for a nutrition rating.",
        labelZh: "糖、鈉、飽和脂肪至少需有兩項資料，才能產生營養評分。",
        impact: "neutral",
        evidenceStrength: "high",
        source: TFDA_FOP_GUIDE_URL,
      }],
    };
  }

  let score = 70;
  const reasons: ScoringReason[] = [];
  for (const key of available) {
    const value = normalized.values[key] as number;
    const threshold = thresholds[key];
    const level = trafficLight(value, threshold.green, threshold.red);
    const adjustment = key === "saturatedFat"
      ? (level === "green" ? 4 : level === "yellow" ? -4 : -15)
      : (level === "green" ? 6 : level === "yellow" ? -4 : -15);
    score += adjustment;
    reasons.push(nutritionReason(key, value, level, normalized.basis, threshold.unit));
  }

  const transFat = normalized.values.transFat;
  if (transFat != null && transFat >= 0.5) {
    score -= 20;
    reasons.push({
      label: `Trans fat: ${formatValue(transFat)} g/${normalized.basis === "per_100ml" ? "100 ml" : "100 g"}`,
      labelZh: `每 ${normalized.basis === "per_100ml" ? "100 ml" : "100 g"} 反式脂肪 ${formatValue(transFat)} g`,
      impact: "negative",
      evidenceStrength: "high",
      source: "https://www.who.int/publications/i/item/9789240073630",
    });
  }

  return { score: Math.max(0, Math.min(100, score)), reasons, basis: normalized.basis };
}

function scoreAdditives(ingredients: IngredientInput[]): {
  score: number | null;
  reasons: ScoringReason[];
  flags: AdditiveFlag[];
  coverage: number | null;
} {
  if (ingredients.length === 0) {
    return {
      score: null,
      flags: [],
      coverage: null,
      reasons: [{
        label: "Ingredient evidence has not been mapped yet.",
        labelZh: "成分文字尚未完成證據對照，不能視為沒有高風險成分。",
        impact: "neutral",
        evidenceStrength: "high",
        source: "FACTA ingredient evidence database",
      }],
    };
  }

  const reviewed = ingredients.filter(i => ["safe", "caution", "avoid"].includes(i.riskLevel ?? ""));
  const coverage = reviewed.length / ingredients.length;
  const avoidIngredients = reviewed.filter(i => i.riskLevel === "avoid");
  const cautionIngredients = reviewed.filter(i => i.riskLevel === "caution");
  const flags: AdditiveFlag[] = [];
  const reasons: ScoringReason[] = [];

  for (const ingredient of avoidIngredients) {
    flags.push({
      name: ingredient.name,
      riskLevel: "avoid",
      reason: ingredient.riskReason ?? "Flagged by regulatory evidence",
      evidenceStrength: ingredient.evidenceStrength ?? "medium",
    });
  }
  for (const ingredient of cautionIngredients) {
    flags.push({
      name: ingredient.name,
      riskLevel: "caution",
      reason: ingredient.riskReason ?? "Use in moderation",
      evidenceStrength: ingredient.evidenceStrength ?? "medium",
    });
  }

  if (avoidIngredients.length > 0 || cautionIngredients.length > 0) {
    reasons.push({
      label: `${avoidIngredients.length + cautionIngredients.length} ingredient flag(s) found`,
      labelZh: `已找到 ${avoidIngredients.length + cautionIngredients.length} 項需留意成分`,
      impact: "negative",
      evidenceStrength: "medium",
      source: "FACTA ingredient evidence database",
    });
  }

  if (coverage < 0.8) {
    reasons.push({
      label: `Only ${Math.round(coverage * 100)}% of listed ingredients have evidence mapping.`,
      labelZh: `目前僅 ${Math.round(coverage * 100)}% 的成分完成證據對照，暫不計算添加物分數。`,
      impact: "neutral",
      evidenceStrength: "high",
      source: "FACTA ingredient evidence database",
    });
    return { score: null, reasons, flags, coverage };
  }

  let score = 85 - avoidIngredients.length * 15 - cautionIngredients.length * 5;
  if (avoidIngredients.length === 0 && cautionIngredients.length === 0) {
    reasons.push({
      label: "No flagged additives found in the reviewed ingredients.",
      labelZh: "在已完成對照的成分中，未找到需留意的添加物。",
      impact: "positive",
      evidenceStrength: "medium",
      source: "FACTA ingredient evidence database",
    });
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons, flags, coverage };
}

function gradeFromScore(score: number): "Excellent" | "Good" | "Consider" | "Poor" {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Consider";
  return "Poor";
}

function verdictFromGrade(grade: string, scope: AnalysisScope): { verdict: string; verdictZh: string } {
  if (scope === "insufficient") {
    return {
      verdict: "Not enough verified label data to rate this product yet.",
      verdictZh: "資料不足，暫時不能判定這款商品是較佳或較差選擇。",
    };
  }
  if (scope === "nutrition_only") {
    return {
      verdict: "Nutrition-only rating; ingredient and allergen evidence is still incomplete.",
      verdictZh: "這是營養初評；成分與過敏原證據尚未完整，不能當作完整安全結論。",
    };
  }
  if (scope === "ingredients_only") {
    return {
      verdict: "Ingredient-only rating; nutrition evidence is still incomplete.",
      verdictZh: "這是成分初評；營養標示資料尚未完整，不能當作完整產品結論。",
    };
  }

  switch (grade) {
    case "Excellent": return { verdict: "Per the current FACTA rules, this is a stronger everyday choice.", verdictZh: "依目前 FACTA 規則，這是相對適合日常選擇的商品。" };
    case "Good": return { verdict: "A reasonable choice, with a few details still worth checking.", verdictZh: "整體表現尚可，仍有少數細節值得確認。" };
    case "Consider": return { verdict: "Several factors deserve attention before choosing it often.", verdictZh: "有幾項因素需要留意，不建議在未比較前經常選擇。" };
    case "Poor": return { verdict: "Multiple high-level concerns; compare alternatives before choosing.", verdictZh: "多項指標落在需留意範圍，建議先比較其他選擇。" };
    default: return { verdict: "Analysis complete.", verdictZh: "分析完成。" };
  }
}

export function calculateScore(input: ScoringInput): ScoringResult {
  const nutrition = input.nutrition ? scoreNutrition(input.nutrition) : { score: null, reasons: [], basis: null };
  const additives = scoreAdditives(input.ingredients ?? []);

  const analysisScope: AnalysisScope =
    nutrition.score !== null && additives.score !== null ? "complete" :
    nutrition.score !== null ? "nutrition_only" :
    additives.score !== null ? "ingredients_only" : "insufficient";

  const overallScore =
    nutrition.score !== null && additives.score !== null ? Math.round(nutrition.score * 0.6 + additives.score * 0.4) :
    nutrition.score ?? additives.score ?? 50;

  const scoreGrade = gradeFromScore(overallScore);
  const { verdict, verdictZh } = verdictFromGrade(scoreGrade, analysisScope);
  const evidenceConfidence: "high" | "medium" | "low" =
    analysisScope === "complete" && input.dataCompleteness >= 0.8 ? "high" :
    analysisScope !== "insufficient" && input.dataCompleteness >= 0.5 ? "medium" : "low";

  const topReasons = [...nutrition.reasons, ...additives.reasons]
    .sort((a, b) => {
      const rank = { negative: 0, neutral: 1, positive: 2 } as const;
      return rank[a.impact] - rank[b.impact];
    })
    .slice(0, 6);

  return {
    overallScore: Math.max(0, Math.min(100, overallScore)),
    nutritionScore: nutrition.score,
    additiveScore: additives.score,
    scoreGrade,
    verdict,
    verdictZh,
    topReasons,
    additiveFlags: additives.flags,
    evidenceConfidence,
    analysisScope,
    nutritionBasis: nutrition.basis,
    ingredientCoverage: additives.coverage == null ? null : round(additives.coverage),
    rulesetVersion: RULESET_VERSION,
  };
}
