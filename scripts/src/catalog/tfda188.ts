import { createHash } from "node:crypto";

export const TFDA_188_SOURCE_KEY = "tfda_food_traceability_188";
export const TFDA_188_SOURCE_URL = "https://data.fda.gov.tw/data/opendata/export/188/json";
export const TFDA_188_DATASET_URL = "https://data.gov.tw/en/datasets/33575";
export const TFDA_188_LICENSE = "Taiwan Open Government Data License 1.0";

export type Tfda188Record = Record<string, string> & {
  產品分類: string;
  公司名稱: string;
  產品名稱: string;
  包裝規格: string;
  產品追溯系統串接碼: string;
};

export type EvidenceTier = "catalog_only" | "nutrition_ready" | "ingredients_ready" | "review_ready";

export interface NormalizedNutritionEvidence {
  basis: "per_100g" | "per_100ml" | "per_serving";
  servingSize: number;
  servingSizeUnit: "g" | "ml";
  calories: number | null;
  protein: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  transFat: number | null;
  totalCarbs: number | null;
  totalSugars: number | null;
  sodium: number | null;
}

export interface CatalogImportCandidate {
  sourceKey: string;
  sourceRecordId: string;
  sourceUrl: string;
  sourceLicense: string;
  payloadSha256: string;
  canonicalKey: string;
  productName: string;
  brandName: string | null;
  categoryName: string | null;
  packageSpec: string | null;
  gtin: null;
  traceabilityCode: string;
  imageUrls: string[];
  ingredientsRaw: string | null;
  nutritionRaw: {
    normalized: NormalizedNutritionEvidence | null;
    sourceFields: Record<string, string>;
  };
  evidenceTier: EvidenceTier;
  nutritionAnalysisEligible: boolean;
  positiveBuyEligible: false;
  verificationStatus: "imported_unverified";
  aiEnrichmentStatus: "not_queued" | "queued";
  qualityFlags: string[];
  rawPayload: Tfda188Record;
}

const NUTRITION_FIELD_KEYS = [
  "每一份量", "本包裝含",
  "每份熱量", "每份蛋白質", "每份脂肪", "每份飽和脂肪", "每份反式脂肪", "每份碳水化合物", "每份糖", "每份鈉",
  "每100公克熱量", "每100公克蛋白質", "每100公克脂肪", "每100公克飽和脂肪", "每100公克反式脂肪", "每100公克碳水化合物", "每100公克糖", "每100公克鈉",
  "每100毫升熱量", "每100毫升蛋白質", "每100毫升脂肪", "每100毫升飽和脂肪", "每100毫升反式脂肪", "每100毫升碳水化合物", "每100毫升糖", "每100毫升鈉",
] as const;

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeIdentity(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_·・|｜()（）\[\]【】]/g, "");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseLabelNumber(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseServing(value: string | null | undefined): { size: number; unit: "g" | "ml" } | null {
  if (!value) return null;
  const size = parseLabelNumber(value);
  if (size == null || size <= 0) return null;
  if (/(毫升|毫公升|ml)/i.test(value)) return { size, unit: "ml" };
  if (/(公克|克|g)/i.test(value)) return { size, unit: "g" };
  return null;
}

function nutritionForBasis(
  record: Tfda188Record,
  basis: "per_100g" | "per_100ml" | "per_serving",
): NormalizedNutritionEvidence | null {
  const prefix = basis === "per_100g" ? "每100公克" : basis === "per_100ml" ? "每100毫升" : "每份";
  const serving = basis === "per_100g"
    ? { size: 100, unit: "g" as const }
    : basis === "per_100ml"
      ? { size: 100, unit: "ml" as const }
      : parseServing(record["每一份量"]);
  if (!serving) return null;

  const value = (nutrient: string) => parseLabelNumber(record[`${prefix}${nutrient}`]);
  const criticalCount = [value("糖"), value("鈉"), value("飽和脂肪")].filter(item => item != null).length;
  if (criticalCount < 2) return null;

  return {
    basis,
    servingSize: serving.size,
    servingSizeUnit: serving.unit,
    calories: value("熱量"),
    protein: value("蛋白質"),
    totalFat: value("脂肪"),
    saturatedFat: value("飽和脂肪"),
    transFat: value("反式脂肪"),
    totalCarbs: value("碳水化合物"),
    totalSugars: value("糖"),
    sodium: value("鈉"),
  };
}

export function extractNutritionEvidence(record: Tfda188Record): NormalizedNutritionEvidence | null {
  return nutritionForBasis(record, "per_100g")
    ?? nutritionForBasis(record, "per_100ml")
    ?? nutritionForBasis(record, "per_serving");
}

function extractUrls(...values: Array<string | null | undefined>): string[] {
  const urls = values.flatMap(value => value?.match(/https?:\/\/[^\s,;|]+/g) ?? []);
  return [...new Set(urls)];
}

export function transformTfda188Record(record: Tfda188Record): CatalogImportCandidate {
  const productName = clean(record["產品名稱"]);
  const traceabilityCode = clean(record["產品追溯系統串接碼"]);
  if (!productName || !traceabilityCode) {
    throw new Error("TFDA record is missing product name or traceability code");
  }

  const brandName = clean(record["公司名稱"]);
  const categoryName = clean(record["產品分類"]);
  const packageSpec = clean(record["包裝規格"]);
  const ingredientsRaw = clean(record["內容物標示"]);
  const nutrition = extractNutritionEvidence(record);
  const imageUrls = extractUrls(
    record["正面外包裝照片"],
    record["反面外包裝照片"],
    record["側面外包裝照片"],
    record["營養標示圖片"],
    record["內容物標示圖片"],
  );
  const labelImageAvailable = Boolean(clean(record["營養標示圖片"]) || clean(record["內容物標示圖片"]));

  const evidenceTier: EvidenceTier = nutrition && ingredientsRaw
    ? "review_ready"
    : nutrition
      ? "nutrition_ready"
      : ingredientsRaw
        ? "ingredients_ready"
        : "catalog_only";
  const qualityFlags = [
    "manufacturer_submitted_source_not_tfda_verified",
    "traceability_code_is_not_gtin",
    !imageUrls.length ? "missing_product_or_label_image" : null,
    !ingredientsRaw ? "missing_machine_readable_ingredients" : null,
    !nutrition ? "missing_score_eligible_nutrition" : null,
    nutrition ? "nutrition_pending_facta_verification" : null,
  ].filter((flag): flag is string => Boolean(flag));

  const sourceFields = Object.fromEntries(
    NUTRITION_FIELD_KEYS.map(key => [key, record[key] ?? ""]),
  );
  const rawPayload = record;
  const canonicalIdentity = [brandName, productName, packageSpec].map(normalizeIdentity).join("|");

  return {
    sourceKey: TFDA_188_SOURCE_KEY,
    sourceRecordId: traceabilityCode,
    sourceUrl: TFDA_188_DATASET_URL,
    sourceLicense: TFDA_188_LICENSE,
    payloadSha256: sha256(JSON.stringify(rawPayload)),
    canonicalKey: sha256(canonicalIdentity),
    productName,
    brandName,
    categoryName,
    packageSpec,
    gtin: null,
    traceabilityCode,
    imageUrls,
    ingredientsRaw,
    nutritionRaw: { normalized: nutrition, sourceFields },
    evidenceTier,
    nutritionAnalysisEligible: Boolean(nutrition),
    positiveBuyEligible: false,
    verificationStatus: "imported_unverified",
    aiEnrichmentStatus: labelImageAvailable && (!ingredientsRaw || !nutrition) ? "queued" : "not_queued",
    qualityFlags,
    rawPayload,
  };
}

export function summarizeTfdaCandidates(candidates: CatalogImportCandidate[]) {
  const evidenceCounts: Record<EvidenceTier, number> = {
    catalog_only: 0,
    nutrition_ready: 0,
    ingredients_ready: 0,
    review_ready: 0,
  };
  for (const candidate of candidates) evidenceCounts[candidate.evidenceTier] += 1;

  return {
    fetchedCount: candidates.length,
    uniqueSourceRecords: new Set(candidates.map(item => item.sourceRecordId)).size,
    uniqueCanonicalKeys: new Set(candidates.map(item => item.canonicalKey)).size,
    evidenceCounts,
    nutritionAnalysisEligible: candidates.filter(item => item.nutritionAnalysisEligible).length,
    positiveBuyEligible: candidates.filter(item => item.positiveBuyEligible).length,
    queuedForAiLabelExtraction: candidates.filter(item => item.aiEnrichmentStatus === "queued").length,
    withAnyImage: candidates.filter(item => item.imageUrls.length > 0).length,
    sourceCaveat: "TFDA publishes these manufacturer-submitted records but does not guarantee their accuracy.",
    safetyRule: "No imported candidate can receive a positive buy recommendation before FACTA verification.",
  };
}
