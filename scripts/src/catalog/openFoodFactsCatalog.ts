import { createHash } from "node:crypto";
import type { EvidenceTier, NormalizedNutritionEvidence } from "./tfda188.js";

export const OFF_SOURCE_KEY = "open_food_facts";
export const OFF_SEARCH_URL = "https://world.openfoodfacts.org/api/v2/search";
export const OFF_LICENSE = "Open Database License (ODbL) 1.0";

export type OpenFoodFactsProduct = {
  code?: string;
  product_name?: string;
  product_name_zh?: string;
  brands?: string;
  categories?: string;
  quantity?: string;
  image_front_url?: string;
  image_nutrition_url?: string;
  image_ingredients_url?: string;
  ingredients_text?: string;
  ingredients_text_zh?: string;
  nutrition_data_per?: string;
  nutriments?: Record<string, unknown>;
  countries_tags?: string[];
  last_modified_t?: number;
};

export interface OpenFoodFactsCandidate {
  sourceKey: typeof OFF_SOURCE_KEY;
  sourceRecordId: string;
  sourceUrl: string;
  sourceLicense: typeof OFF_LICENSE;
  payloadSha256: string;
  canonicalKey: string;
  productName: string;
  brandName: string | null;
  categoryName: string | null;
  packageSpec: string | null;
  gtin: string;
  traceabilityCode: null;
  imageUrls: string[];
  ingredientsRaw: string | null;
  nutritionRaw: { normalized: NormalizedNutritionEvidence | null; sourceFields: Record<string, unknown> };
  evidenceTier: EvidenceTier;
  nutritionAnalysisEligible: boolean;
  positiveBuyEligible: false;
  verificationStatus: "imported_unverified";
  aiEnrichmentStatus: "not_queued" | "queued";
  qualityFlags: string[];
  rawPayload: OpenFoodFactsProduct;
}
function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\-_·・|｜()（）\[\]【】]/g, "");
}

export function isValidGtin(value: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const check = digits.pop();
  if (check == null) return false;
  let sum = 0;
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += digits[index]! * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

function normalizedNutrition(product: OpenFoodFactsProduct): {
  nutrition: NormalizedNutritionEvidence | null;
  flags: string[];
} {
  const raw = product.nutriments ?? {};
  const basis = product.nutrition_data_per === "100ml" ? "per_100ml" as const : "per_100g" as const;
  const sodiumGrams = finite(raw["sodium_100g"]);
  const nutrition: NormalizedNutritionEvidence = {
    basis,
    servingSize: 100,
    servingSizeUnit: basis === "per_100ml" ? "ml" : "g",
    calories: finite(raw["energy-kcal_100g"]),
    protein: finite(raw["proteins_100g"]),
    totalFat: finite(raw["fat_100g"]),
    saturatedFat: finite(raw["saturated-fat_100g"]),
    transFat: finite(raw["trans-fat_100g"]),
    totalCarbs: finite(raw["carbohydrates_100g"]),
    totalSugars: finite(raw["sugars_100g"]),
    sodium: sodiumGrams == null ? null : Math.round(sodiumGrams * 1000 * 100) / 100,
  };
  const flags: string[] = [];
  const macroValues = [nutrition.protein, nutrition.totalFat, nutrition.totalCarbs, nutrition.totalSugars, nutrition.saturatedFat];
  if (macroValues.some(value => value != null && value > 100)) flags.push("nutrient_exceeds_100_per_100_basis");
  if (nutrition.sodium != null && nutrition.sodium > 100_000) flags.push("sodium_out_of_range");

  if (
    nutrition.calories != null
    && nutrition.protein != null
    && nutrition.totalFat != null
    && nutrition.totalCarbs != null
  ) {
    const estimated = nutrition.protein * 4 + nutrition.totalCarbs * 4 + nutrition.totalFat * 9;
    const tolerance = Math.max(35, nutrition.calories * 0.35);
    if (Math.abs(estimated - nutrition.calories) > tolerance) flags.push("energy_macro_inconsistent");
  }

  const criticalCount = [nutrition.totalSugars, nutrition.sodium, nutrition.saturatedFat]
    .filter(value => value != null).length;
  if (criticalCount < 2) return { nutrition: null, flags: [...flags, "missing_score_eligible_nutrition"] };
  if (flags.length > 0) return { nutrition: null, flags };
  return { nutrition, flags };
}

export function transformOpenFoodFactsProduct(product: OpenFoodFactsProduct): OpenFoodFactsCandidate {
  const gtin = clean(product.code);
  const productName = clean(product.product_name_zh) ?? clean(product.product_name);
  if (!gtin || !isValidGtin(gtin)) throw new Error("Open Food Facts record has no valid GTIN");
  if (!productName) throw new Error("Open Food Facts record has no product name");

  const brandName = clean(product.brands)?.split(",")[0]?.trim() || null;
  const ingredientsRaw = clean(product.ingredients_text_zh) ?? clean(product.ingredients_text);
  const { nutrition, flags: nutritionFlags } = normalizedNutrition(product);
  const imageUrls = [...new Set([
    clean(product.image_front_url),
    clean(product.image_nutrition_url),
    clean(product.image_ingredients_url),
  ].filter((value): value is string => Boolean(value)))];
  const labelImageAvailable = Boolean(clean(product.image_nutrition_url) || clean(product.image_ingredients_url));
  const evidenceTier: EvidenceTier = nutrition && ingredientsRaw
    ? "review_ready"
    : nutrition
      ? "nutrition_ready"
      : ingredientsRaw
        ? "ingredients_ready"
        : "catalog_only";
  const qualityFlags = [
    "community_contributed_source_not_facta_verified",
    "gtin_identity_from_open_food_facts",
    ...nutritionFlags,
    !ingredientsRaw ? "missing_machine_readable_ingredients" : null,
    nutrition ? "nutrition_pending_facta_verification" : null,
    !imageUrls.length ? "missing_product_or_label_image" : null,
  ].filter((value): value is string => Boolean(value));
  const rawPayload = product;
  const canonicalKey = sha256([brandName, productName, clean(product.quantity)]
    .map(value => normalizeIdentity(value ?? "")).join("|"));

  return {
    sourceKey: OFF_SOURCE_KEY,
    sourceRecordId: gtin,
    sourceUrl: `https://world.openfoodfacts.org/product/${gtin}`,
    sourceLicense: OFF_LICENSE,
    payloadSha256: sha256(JSON.stringify(rawPayload)),
    canonicalKey,
    productName,
    brandName,
    categoryName: clean(product.categories),
    packageSpec: clean(product.quantity),
    gtin,
    traceabilityCode: null,
    imageUrls,
    ingredientsRaw,
    nutritionRaw: { normalized: nutrition, sourceFields: product.nutriments ?? {} },
    evidenceTier,
    nutritionAnalysisEligible: Boolean(nutrition),
    positiveBuyEligible: false,
    verificationStatus: "imported_unverified",
    aiEnrichmentStatus: labelImageAvailable && (!ingredientsRaw || !nutrition) ? "queued" : "not_queued",
    qualityFlags,
    rawPayload,
  };
}

export function summarizeOpenFoodFactsCandidates(candidates: OpenFoodFactsCandidate[]) {
  return {
    accepted: candidates.length,
    uniqueGtins: new Set(candidates.map(candidate => candidate.gtin)).size,
    reviewReady: candidates.filter(candidate => candidate.evidenceTier === "review_ready").length,
    nutritionReady: candidates.filter(candidate => candidate.nutritionAnalysisEligible).length,
    withImages: candidates.filter(candidate => candidate.imageUrls.length > 0).length,
    queuedForAi: candidates.filter(candidate => candidate.aiEnrichmentStatus === "queued").length,
    positiveBuyEligible: 0,
  };
}
