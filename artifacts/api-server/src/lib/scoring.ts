/**
 * FACTA deterministic scoring engine v2.
 *
 * Nutrition values are normalized from the labelled serving size to 100 g/ml
 * before applying the 2026 TFDA front-of-pack traffic-light thresholds.
 * Missing evidence changes the scope/confidence of a result; it is never
 * treated as evidence that a product is safe.
 */

// v2.3 keeps the dedicated water path and adds source-backed ingredient-only
// decisions. A confirmed ingredient label can now support a frequency action
// even when the package omits the nutrient values needed for a full score.
export const RULESET_VERSION = "2.3.0";
export const TFDA_FOP_GUIDE_URL = "https://www.fda.gov.tw/tc/newsContent.aspx?cid=4&id=31511";
export const TFDA_WATER_LABEL_EXEMPTION_URL = "https://www.fda.gov.tw/TC/siteContent.aspx?sid=12343";
export const WHO_DRINKING_WATER_PH_URL = "https://www.who.int/publications/m/item/chemical-fact-sheets--ph";
export const WHO_DRINKING_WATER_QUALITY_URL = "https://www.who.int/publications/i/item/9789240121225";

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
  riskReasonZh?: string | null;
  source?: string | null;
}

interface ScoringInput {
  nutrition?: NutritionInput | null;
  ingredients?: IngredientInput[];
  productName?: string | null;
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

export type AnalysisScope = "complete" | "nutrition_only" | "ingredients_only" | "water" | "insufficient";

export type ProductActionCode = "buy" | "limit" | "swap" | "complete_data";

export interface ProductActionRecommendation {
  code: ProductActionCode;
  label: string;
  labelZh: string;
  reason: string;
  reasonZh: string;
  isPersonalized: boolean;
}

interface ProductActionInput {
  analysisScope: AnalysisScope;
  overallScore: number;
  evidenceConfidence: "high" | "medium" | "low" | string | null;
  topReasons?: ScoringReason[] | null;
  additiveFlags?: AdditiveFlag[] | null;
}

function withoutTerminalPunctuation(value: string): string {
  return value.replace(/[.!?。！？]+$/u, "").trim();
}

/**
 * Turn the evidence report into one immediate consumer action.
 *
 * A positive "buy" call is intentionally harder to earn than a numeric score:
 * both nutrition and ingredient evidence must be complete, confidence must be
 * high, and no negative reason may remain. Confirmed red flags can still lead
 * to "limit" or "swap" with partial evidence, while missing evidence never
 * becomes a positive recommendation.
 */
export function recommendProductAction(input: ProductActionInput): ProductActionRecommendation {
  const negativeReasons = (input.topReasons ?? []).filter(reason => reason.impact === "negative");
  const hasAvoidIngredient = (input.additiveFlags ?? []).some(flag => flag.riskLevel === "avoid");

  if (input.analysisScope === "water") {
    return {
      code: "buy",
      label: "Good for hydration",
      labelZh: "可以喝",
      reason: "The confirmed formula is plain unsweetened water. An alkaline or pH claim is not treated as an added health benefit.",
      reasonZh: "已確認是無糖、無調味的單純飲用水，適合日常補水；鹼性或 pH 宣稱不算額外健康加分。",
      isPersonalized: false,
    };
  }

  if (input.analysisScope === "insufficient") {
    return {
      code: "complete_data",
      label: "Complete the label",
      labelZh: "先補資料",
      reason: "There is not enough verified label evidence to recommend buying, limiting, or swapping this product.",
      reasonZh: "目前沒有足夠的包裝證據，不能負責任地叫你買、少吃或換掉；先補拍成分與營養標示。",
      isPersonalized: false,
    };
  }

  const strongConcern = hasAvoidIngredient || input.overallScore < 40 || negativeReasons.length >= 2;
  if (strongConcern) {
    return {
      code: "swap",
      label: "Swap it",
      labelZh: "換一款",
      reason: "The verified evidence already shows multiple material concerns or an ingredient to avoid.",
      reasonZh: "已確認的證據已有多項明顯疑慮，或出現建議避開的成分；先比較同類商品，不要把這款當日常選擇。",
      isPersonalized: false,
    };
  }

  const shouldLimit = input.overallScore < 80 || negativeReasons.length > 0;
  if (shouldLimit) {
    const firstConcernZh = negativeReasons[0]?.labelZh;
    const firstConcern = negativeReasons[0]?.label;
    return {
      code: "limit",
      label: "Have less often",
      labelZh: "少吃",
      reason: firstConcern
        ? `Keep this as an occasional choice, not an everyday one. ${withoutTerminalPunctuation(firstConcern)}.`
        : "The current evidence does not support making this an everyday choice.",
      reasonZh: firstConcernZh
        ? `這款先偶爾吃，不要當每天的選擇。${withoutTerminalPunctuation(firstConcernZh)}。`
        : "目前證據不支持把這款當作每天常吃的選擇，建議降低頻率。",
      isPersonalized: false,
    };
  }

  if (input.analysisScope !== "complete" || input.evidenceConfidence !== "high") {
    return {
      code: "complete_data",
      label: "Complete the label",
      labelZh: "先補資料",
      reason: "The available evidence looks favorable, but it is not complete enough for a positive buying recommendation.",
      reasonZh: "目前看到的資料偏正向，但成分、過敏原或證據完整度仍不足，還不能直接下「可以買」的結論。",
      isPersonalized: false,
    };
  }

  return {
    code: "buy",
    label: "Buy",
    labelZh: "可以買",
    reason: "Nutrition and ingredient evidence are complete, confidence is high, and no current red flag was found.",
    reasonZh: "營養與成分證據已達完整門檻、信心高，且目前沒有找到紅燈指標；可以列入日常選擇。",
    isPersonalized: false,
  };
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
  analysisScope: AnalysisScope;
  nutritionBasis: "per_100g" | "per_100ml" | null;
  ingredientCoverage: number | null;
  actionRecommendation: ProductActionRecommendation;
  rulesetVersion: string;
}

type ScoringResultWithoutAction = Omit<ScoringResult, "actionRecommendation" | "rulesetVersion">;

interface NormalizedNutrition {
  foodForm: FoodForm;
  basis: "per_100g" | "per_100ml";
  values: Omit<NutritionInput, "servingSize" | "servingSizeUnit">;
}

const WATER_PRODUCT_NAME_PATTERN = /(飲用水|礦泉水|純水|純淨水|天然水|離子水|鹼性水|海洋深層水|深層海水|氣泡水|sparkling\s*water|mineral\s*water|alkaline\s*water)/i;
const WATER_DISQUALIFIER_PATTERN = /(砂糖|蔗糖|果糖|糖漿|葡萄糖|蜂蜜|果汁|香料|甜味|咖啡|茶|乳|奶|酒精|維生素|防腐劑|色素)/i;
const PLAIN_WATER_INGREDIENTS = new Set([
  "水", "飲用水", "純水", "純淨水", "天然水", "礦泉水", "逆滲透水", "ro水",
  "海水", "深層海水", "海洋深層水", "電解水", "離子水", "鹼性離子水",
  "二氧化碳", "碳酸水", "海洋礦物質", "礦物質", "海水濃縮礦物質液",
  "氯化鈉", "氯化鉀", "氯化鈣", "氯化鎂", "硫酸鎂", "碳酸氫鈉",
]);

function normalizeWaterIngredient(value: string): string {
  return value
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s·・._-]/g, "")
    .trim();
}

/** A water-like name alone is not enough: every confirmed ingredient must be water, carbonation, or a whitelisted mineral salt. */
export function isPlainWaterProduct(input: Pick<ScoringInput, "productName" | "ingredients">): boolean {
  const productName = input.productName?.trim() ?? "";
  const ingredients = (input.ingredients ?? []).map(item => normalizeWaterIngredient(item.name)).filter(Boolean);
  if (!WATER_PRODUCT_NAME_PATTERN.test(productName) || ingredients.length === 0) return false;
  if (ingredients.some(name => WATER_DISQUALIFIER_PATTERN.test(name))) return false;
  return ingredients.every(name => PLAIN_WATER_INGREDIENTS.has(name));
}

export function resolveAnalysisScope(
  scores: { nutritionScore?: number | null; additiveScore?: number | null },
  context?: Pick<ScoringInput, "productName" | "ingredients">,
): AnalysisScope {
  if (context && isPlainWaterProduct(context)) return "water";
  if (scores.nutritionScore != null && scores.additiveScore != null) return "complete";
  if (scores.nutritionScore != null) return "nutrition_only";
  if (scores.additiveScore != null) return "ingredients_only";
  return "insufficient";
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
  const distinctSignals = (items: IngredientInput[]): IngredientInput[] => {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = `${item.riskLevel}|${item.riskReasonZh ?? item.riskReason ?? item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const avoidIngredients = distinctSignals(reviewed.filter(i => i.riskLevel === "avoid"));
  const cautionIngredients = distinctSignals(reviewed.filter(i => i.riskLevel === "caution"));
  const flags: AdditiveFlag[] = [];
  const reasons: ScoringReason[] = [];

  for (const ingredient of avoidIngredients) {
    flags.push({
      name: ingredient.name,
      riskLevel: "avoid",
      reason: ingredient.riskReasonZh ?? ingredient.riskReason ?? "Flagged by regulatory evidence",
      evidenceStrength: ingredient.evidenceStrength ?? "medium",
    });
  }
  for (const ingredient of cautionIngredients) {
    flags.push({
      name: ingredient.name,
      riskLevel: "caution",
      reason: ingredient.riskReasonZh ?? ingredient.riskReason ?? "Use in moderation",
      evidenceStrength: ingredient.evidenceStrength ?? "medium",
    });
  }

  if (avoidIngredients.length > 0 || cautionIngredients.length > 0) {
    const flagged = [...avoidIngredients, ...cautionIngredients];
    const names = flagged.map(item => item.name).slice(0, 4).join("、");
    reasons.push({
      label: `${flagged.length} labelled ingredient signal(s) warrant a lower everyday frequency; this is not a toxicity claim.`,
      labelZh: `成分表有 ${flagged.length} 項會影響日常食用頻率${names ? `（${names}）` : ""}；這不是把合法添加物說成有毒。`,
      impact: "negative",
      evidenceStrength: "medium",
      source: flagged.find(item => item.source)?.source ?? "FACTA ingredient evidence database",
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

function scorePlainWater(input: ScoringInput): ScoringResult {
  const hasAlkalineClaim = /(鹼性|p\s*h\s*9|alkaline)/i.test(input.productName ?? "");
  const normalized = input.nutrition ? normalizeNutritionPer100(input.nutrition) : null;
  const sodium = normalized?.values.sodium;
  const reasons: ScoringReason[] = [
    {
      label: "The confirmed ingredient list contains only water sources or mineral components; no sugar, sweetener or flavouring is listed.",
      labelZh: "已確認的成分僅見水類來源或礦物成分，未見糖、甜味劑或香料。",
      impact: "positive",
      evidenceStrength: "medium",
      source: "使用者確認的包裝成分",
    },
    {
      label: "Taiwan permits drinking and mineral water without nutrition claims to omit a nutrition label.",
      labelZh: "依食藥署規定，未作營養宣稱的飲用水與礦泉水可免營養標示；沒有營養表不應被判成資料不足。",
      impact: "neutral",
      evidenceStrength: "high",
      source: TFDA_WATER_LABEL_EXEMPTION_URL,
    },
  ];

  if (hasAlkalineClaim) {
    reasons.push({
      label: "WHO does not set a health-based guideline value for drinking-water pH, so pH 9 alone is not evidence of an added health benefit.",
      labelZh: "pH 代表酸鹼值；WHO 未為飲用水 pH 訂定健康基準值，因此 pH 9 本身不能證明有額外保健功效。",
      impact: "neutral",
      evidenceStrength: "high",
      source: WHO_DRINKING_WATER_PH_URL,
    });
  }

  reasons.push(sodium != null && normalized ? {
    label: `The label provides sodium at ${formatValue(sodium)} mg per 100 ml for comparison with other water products.`,
    labelZh: `包裝提供的鈉換算為每 100 ml ${formatValue(sodium)} mg，可用來和其他飲用水比較。`,
    impact: "neutral",
    evidenceStrength: "high",
    source: "使用者確認的包裝營養標示",
  } : {
    label: "No sodium or mineral quantity is stated, so this report cannot compare the mineral profile with other water products.",
    labelZh: "包裝未提供鈉或礦物質含量，因此這份報告不能比較不同飲用水的礦物組成。",
    impact: "neutral",
    evidenceStrength: "high",
    source: "使用者確認的包裝標示",
  });

  reasons.push({
    label: "A package photo cannot verify microbiological, heavy-metal or process safety; those require official testing and current safety records.",
    labelZh: "包裝照片無法驗證微生物、重金屬或製程安全，仍需搭配官方抽驗與近期食安紀錄。",
    impact: "neutral",
    evidenceStrength: "high",
    source: WHO_DRINKING_WATER_QUALITY_URL,
  });

  const resultWithoutAction: ScoringResultWithoutAction = {
    // Storage compatibility only; the water UI deliberately hides this internal score.
    overallScore: 85,
    nutritionScore: null,
    additiveScore: null,
    scoreGrade: "Excellent",
    verdict: hasAlkalineClaim
      ? "Plain unsweetened water suitable for everyday hydration; the alkaline claim is not treated as an added health benefit."
      : "Plain unsweetened water suitable for everyday hydration; package evidence does not replace official water-quality testing.",
    verdictZh: hasAlkalineClaim
      ? "成分未見糖或調味添加，可作為日常補水選擇；鹼性／pH 宣稱不會被當成額外健康加分。"
      : "成分未見糖或調味添加，可作為日常補水選擇；包裝資訊仍不能代替官方水質檢驗。",
    topReasons: reasons,
    additiveFlags: [],
    evidenceConfidence: "medium",
    analysisScope: "water",
    nutritionBasis: normalized?.basis ?? null,
    ingredientCoverage: 1,
  };
  return {
    ...resultWithoutAction,
    actionRecommendation: recommendProductAction(resultWithoutAction),
    rulesetVersion: RULESET_VERSION,
  };
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
      verdict: "Ingredient-only rating: enough evidence for a frequency recommendation, but not a complete nutrient comparison.",
      verdictZh: "這是成分初評：現有證據足以建議食用頻率，但缺少糖、鈉與飽和脂肪數值，不能當作完整營養比較。",
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
  if (isPlainWaterProduct(input)) return scorePlainWater(input);

  const nutrition = input.nutrition ? scoreNutrition(input.nutrition) : { score: null, reasons: [], basis: null };
  const additives = scoreAdditives(input.ingredients ?? []);

  const analysisScope = resolveAnalysisScope({
    nutritionScore: nutrition.score,
    additiveScore: additives.score,
  });

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

  const resultWithoutAction: ScoringResultWithoutAction = {
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
  };
  return {
    ...resultWithoutAction,
    actionRecommendation: recommendProductAction(resultWithoutAction),
    rulesetVersion: RULESET_VERSION,
  };
}
