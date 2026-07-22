import {
  calculateScore,
  normalizeNutritionPer100,
  type NutritionInput,
} from "./scoring.js";

export type CandidateEvidenceTier = "catalog_only" | "nutrition_ready" | "ingredients_ready" | "review_ready";

export interface ShoppingLink {
  retailerName: string;
  url: string;
}

export interface PreliminaryNutritionComparison {
  comparisonStatus: "nutrition_prefilter" | "identity_only";
  preliminaryNutritionScore: number | null;
  scoreDelta: number | null;
  preliminaryBetter: boolean;
  reasonsZh: string[];
}

export interface CommerceCandidate {
  name: string;
  brandName: string | null;
  retailerName: string;
  priceNtd: number | null;
  productUrl: string;
  whyMatchZh: string;
}

const PRODUCT_FAMILY_TERMS = [
  "益生菌", "優酪乳", "乳酸菌", "植物奶", "燕麥奶", "氣泡水", "礦泉水", "飲用水",
  "海洋深層水", "豆漿", "牛奶", "優格", "仙貝", "米果", "洋芋片", "蘇打餅乾",
  "餅乾", "麥片", "穀片", "燕麥", "蛋白飲", "蛋白粉", "能量棒", "堅果", "果乾",
  "巧克力", "糖果", "咖啡", "茶飲", "果汁", "運動飲料", "調味乳", "醬油", "沙茶醬",
  "泡麵", "麵條", "冷凍水餃", "優格飲", "乳酪", "起司", "麵包", "吐司",
] as const;

const GENERIC_CATEGORY_PATTERN = /^(食品|其他|未分類|未分類其他製品|一般食品|營養食品製品)$/;

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

const LEADING_PACK_SIZE_PATTERN = /^[\s\[\]【】()（）]*(?:\d+(?:\.\d+)?\s*(?:罐|瓶|包|入|組|箱|盒|袋|件|枚|顆|片|毫升|公克|公斤|ml|g|kg|l)\s*(?:[x×*\/／]\s*(?:\d+\s*)?(?:罐|瓶|包|入|組|箱|盒|袋|件|枚|顆|片))?)[\s\[\]【】()（）:：\-–—]*/i;

/**
 * Commerce titles often begin with merchandising text such as 「24罐/箱」.
 * Search models occasionally echo that value into brandName. Keep uncertain
 * brands empty instead of carrying a clearly wrong value into label review.
 */
export function sanitizeCommerceBrand(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = normalizeText(value).slice(0, 100);
  const withoutPackSize = normalized.replace(LEADING_PACK_SIZE_PATTERN, "").trim();
  return withoutPackSize || null;
}

/**
 * Derive a small, explainable set of same-product-family terms. These terms
 * drive deterministic database search; AI is reserved for live commerce
 * discovery and never decides the health recommendation by itself.
 */
export function extractDiscoveryTerms(input: {
  productName: string;
  brandName?: string | null;
  categoryName?: string | null;
}): string[] {
  const productName = normalizeText(input.productName);
  const categoryName = normalizeText(input.categoryName ?? "");
  const terms: string[] = [];

  for (const term of PRODUCT_FAMILY_TERMS) {
    if (productName.includes(term) || categoryName.includes(term)) terms.push(term);
  }

  if (categoryName && !GENERIC_CATEGORY_PATTERN.test(categoryName)) terms.push(categoryName);

  if (terms.length === 0) {
    const brand = normalizeText(input.brandName ?? "");
    const cleaned = productName
      .replace(brand, " ")
      .replace(/[（(][^）)]*[）)]/g, " ")
      .replace(/\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|包|瓶|盒|入|顆|片)\b/gi, " ")
      .replace(/(?:高效|全效|特濃|經典|原味|風味|限定|升級版|新品)/g, " ")
      .replace(/[｜|·・/_-]+/g, " ");
    terms.push(...cleaned.split(/\s+/).filter(term => term.length >= 2));
  }

  return [...new Set(terms.map(normalizeText).filter(term => term.length >= 2))].slice(0, 3);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Convert source-backed JSON nutrition into the same input used by FACTA's deterministic scorer. */
export function nutritionInputFromRaw(value: unknown): NutritionInput | null {
  if (!value || typeof value !== "object") return null;
  const container = value as Record<string, unknown>;
  const raw = container.normalized && typeof container.normalized === "object"
    ? container.normalized as Record<string, unknown>
    : container;

  const servingSize = finiteNumber(raw.servingSize);
  const servingSizeUnit = typeof raw.servingSizeUnit === "string" ? raw.servingSizeUnit.trim().toLowerCase() : null;
  if (!servingSize || !servingSizeUnit || !/^(g|ml|公克|克|毫升|毫公升)$/.test(servingSizeUnit)) return null;

  const input: NutritionInput = {
    servingSize,
    servingSizeUnit,
    calories: finiteNumber(raw.calories),
    protein: finiteNumber(raw.protein),
    totalFat: finiteNumber(raw.totalFat),
    saturatedFat: finiteNumber(raw.saturatedFat),
    transFat: finiteNumber(raw.transFat),
    totalCarbs: finiteNumber(raw.totalCarbs),
    dietaryFiber: finiteNumber(raw.dietaryFiber),
    totalSugars: finiteNumber(raw.totalSugars),
    sodium: finiteNumber(raw.sodium),
  };
  const criticalCount = [input.totalSugars, input.sodium, input.saturatedFat].filter(item => item != null).length;
  return criticalCount >= 2 ? input : null;
}

function formattedDelta(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${unit}`;
}

/**
 * Produce a cautious nutrition-only prefilter. It may prioritize which label
 * FACTA should verify next, but cannot by itself become a positive buy call.
 */
export function compareCandidateNutrition(
  original: NutritionInput | null,
  candidate: NutritionInput | null,
): PreliminaryNutritionComparison {
  if (!original || !candidate) {
    return {
      comparisonStatus: "identity_only",
      preliminaryNutritionScore: null,
      scoreDelta: null,
      preliminaryBetter: false,
      reasonsZh: [],
    };
  }

  const originalNormalized = normalizeNutritionPer100(original);
  const candidateNormalized = normalizeNutritionPer100(candidate);
  if (!originalNormalized || !candidateNormalized || originalNormalized.basis !== candidateNormalized.basis) {
    return {
      comparisonStatus: "identity_only",
      preliminaryNutritionScore: null,
      scoreDelta: null,
      preliminaryBetter: false,
      reasonsZh: [],
    };
  }

  const originalResult = calculateScore({ nutrition: original, ingredients: [], dataCompleteness: 0.5 });
  const candidateResult = calculateScore({ nutrition: candidate, ingredients: [], dataCompleteness: 0.5 });
  const originalScore = originalResult.nutritionScore;
  const candidateScore = candidateResult.nutritionScore;
  if (originalScore == null || candidateScore == null) {
    return {
      comparisonStatus: "identity_only",
      preliminaryNutritionScore: candidateScore,
      scoreDelta: null,
      preliminaryBetter: false,
      reasonsZh: [],
    };
  }

  const basis = candidateNormalized.basis === "per_100ml" ? "每 100 ml" : "每 100 g";
  const reasonsZh: string[] = [];
  const nutrientDefs = [
    { key: "totalSugars" as const, label: "糖", unit: "g", minimum: 0.5 },
    { key: "sodium" as const, label: "鈉", unit: "mg", minimum: 10 },
    { key: "saturatedFat" as const, label: "飽和脂肪", unit: "g", minimum: 0.2 },
  ];
  for (const nutrient of nutrientDefs) {
    const before = originalNormalized.values[nutrient.key];
    const after = candidateNormalized.values[nutrient.key];
    if (before == null || after == null || before - after < nutrient.minimum) continue;
    reasonsZh.push(`${basis}${nutrient.label}少 ${formattedDelta(before - after, nutrient.unit)}`);
  }

  const scoreDelta = candidateScore - originalScore;
  return {
    comparisonStatus: "nutrition_prefilter",
    preliminaryNutritionScore: candidateScore,
    scoreDelta,
    preliminaryBetter: scoreDelta >= 5 && reasonsZh.length > 0,
    reasonsZh: reasonsZh.slice(0, 3),
  };
}

export function buildShoppingLinks(productName: string, brandName?: string | null): ShoppingLink[] {
  const query = encodeURIComponent([brandName, productName].filter(Boolean).join(" "));
  return [
    { retailerName: "momo", url: `https://www.momoshop.com.tw/search/searchShop.jsp?keyword=${query}` },
    { retailerName: "PChome", url: `https://ecshweb.pchome.com.tw/search/v3.3/?q=${query}` },
    { retailerName: "蝦皮", url: `https://shopee.tw/search?keyword=${query}` },
  ];
}

const TRUSTED_COMMERCE_DOMAINS = [
  "momoshop.com.tw", "pchome.com.tw", "shopee.tw", "carrefour.com.tw", "pxgo.com.tw",
  "costco.com.tw", "etmall.com.tw", "watsons.com.tw", "cosmed.com.tw", "books.com.tw",
  "rakuten.com.tw", "ruten.com.tw",
];

function trustedCommerceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const trusted = TRUSTED_COMMERCE_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    if (!trusted) return null;

    // Search-result pages are useful as a fallback link, but they are not
    // evidence that a specific product listing currently exists. Live catalog
    // candidates must therefore resolve to a product/detail page.
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host.startsWith("search.") || host.startsWith("find.")) return null;
    if (/(?:^|\/)(?:search|find)(?:\/|\.|$)/i.test(path)) return null;
    if (/searchshop\.jsp$/i.test(path)) return null;

    return url.toString();
  } catch {
    return null;
  }
}

/** Keep only direct, inspectable listings from known Taiwan commerce domains. */
export function sanitizeCommerceCandidates(value: unknown): CommerceCandidate[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const results: CommerceCandidate[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === "string" ? normalizeText(item.name).slice(0, 180) : "";
    const retailerName = typeof item.retailerName === "string" ? normalizeText(item.retailerName).slice(0, 80) : "";
    const productUrl = trustedCommerceUrl(item.productUrl);
    if (!name || !retailerName || !productUrl || seen.has(productUrl)) continue;
    seen.add(productUrl);
    results.push({
      name,
      brandName: sanitizeCommerceBrand(item.brandName),
      retailerName,
      priceNtd: finiteNumber(item.priceNtd),
      productUrl,
      whyMatchZh: typeof item.whyMatchZh === "string" && item.whyMatchZh.trim()
        ? normalizeText(item.whyMatchZh).slice(0, 180)
        : "商品名稱與原商品屬同一類型；仍需核對現售包裝標示。",
    });
    if (results.length >= 6) break;
  }
  return results;
}
