import {
  buildShoppingLinks,
  sanitizeCommerceCandidates,
  type CommerceCandidate,
  type ShoppingLink,
} from "./alternativeDiscovery.js";

export interface RankedCommerceCandidate extends CommerceCandidate {
  matchConfidence: "exact" | "strong" | "related";
  matchScore: number;
  shoppingLinks: ShoppingLink[];
}
const INTENT_EXPANSIONS: Record<string, string[]> = {
  "水": ["飲用水", "礦泉水", "瓶裝水", "純水", "離子水", "氣泡水"],
  "牛奶": ["鮮乳", "保久乳", "全脂牛乳", "低脂牛乳", "牛奶"],
  "奶": ["鮮乳", "保久乳", "牛乳", "牛奶"],
  "茶": ["無糖茶", "茶飲", "綠茶", "烏龍茶", "紅茶"],
  "咖啡": ["黑咖啡", "即飲咖啡", "拿鐵", "咖啡飲料"],
  "優格": ["優格", "希臘優格", "無糖優格", "優酪乳"],
  "麥片": ["燕麥片", "早餐穀片", "穀物麥片", "即食燕麥"],
  "蛋白": ["蛋白飲", "蛋白棒", "蛋白粉", "高蛋白"],
};

const NEGATIVE_INTENT_TERMS: Record<string, string[]> = {
  "水": ["水晶", "水果", "水蜜桃", "水餃", "水煮", "水產", "化妝水"],
  "奶": ["奶糖", "奶油", "奶酥", "奶片"],
  "牛奶": ["牛奶糖", "牛奶片", "牛奶風味"],
};

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\-_·・|｜()（）\[\]【】]/g, "");
}

function textTokens(query: string): string[] {
  const normalized = query.normalize("NFKC").trim();
  if (!normalized) return [];
  const segmented = normalized
    .split(/[\s,，、/｜|]+/)
    .map(item => item.trim())
    .filter(item => item.length >= 2);
  return segmented.length > 0 ? segmented : [normalized];
}

/**
 * Expand ambiguous short Chinese searches into product-family phrases. This
 * prevents searches such as 「水」 from being dominated by 水晶餃 or 水蜜桃.
 */
export function expandCatalogSearchTerms(query: string): string[] {
  const trimmed = query.normalize("NFKC").trim();
  const exactIntent = INTENT_EXPANSIONS[trimmed];
  if (exactIntent) return exactIntent;
  return [...new Set(textTokens(trimmed))].slice(0, 6);
}

export function scoreCatalogCandidate(query: string, input: {
  name: string;
  brandName?: string | null;
  categoryName?: string | null;
}): number {
  const normalizedQuery = normalize(query);
  const normalizedName = normalize(input.name);
  const normalizedBrand = normalize(input.brandName ?? "");
  const normalizedCategory = normalize(input.categoryName ?? "");
  const haystack = `${normalizedName}|${normalizedBrand}|${normalizedCategory}`;
  const terms = expandCatalogSearchTerms(query).map(normalize).filter(Boolean);
  const negatives = (NEGATIVE_INTENT_TERMS[query.normalize("NFKC").trim()] ?? []).map(normalize);

  if (negatives.some(term => normalizedName.includes(term))) return -100;
  if (normalizedQuery.length >= 2 && normalizedName === normalizedQuery) return 100;
  if (normalizedQuery.length >= 2 && normalizedName.startsWith(normalizedQuery)) return 92;
  if (normalizedQuery.length >= 2 && normalizedName.includes(normalizedQuery)) return 84;

  let score = 0;
  for (const term of terms) {
    if (normalizedName === term) score = Math.max(score, 88);
    else if (normalizedName.includes(term)) score = Math.max(score, 76);
    else if (normalizedCategory.includes(term)) score = Math.max(score, 68);
    else if (normalizedBrand.includes(term)) score = Math.max(score, 52);
  }

  const tokenHits = textTokens(query).map(normalize).filter(token => haystack.includes(token)).length;
  return score + Math.min(tokenHits * 4, 12);
}

export function rankCommerceCandidates(query: string, value: unknown): RankedCommerceCandidate[] {
  const candidates = sanitizeCommerceCandidates(value);
  const deduped = new Map<string, RankedCommerceCandidate>();

  for (const candidate of candidates) {
    const matchScore = scoreCatalogCandidate(query, candidate);
    if (matchScore < 50) continue;
    const ranked: RankedCommerceCandidate = {
      ...candidate,
      matchScore,
      matchConfidence: matchScore >= 90 ? "exact" : matchScore >= 70 ? "strong" : "related",
      shoppingLinks: buildShoppingLinks(candidate.name, candidate.brandName),
    };
    const identity = normalize(`${candidate.brandName ?? ""}${candidate.name}`);
    const existing = deduped.get(identity);
    if (!existing || ranked.matchScore > existing.matchScore) deduped.set(identity, ranked);
  }

  return [...deduped.values()]
    .sort((a, b) => b.matchScore - a.matchScore || Number(a.priceNtd == null) - Number(b.priceNtd == null))
    .slice(0, 8);
}
