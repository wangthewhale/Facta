import { createHash } from "node:crypto";

export const SEVEN_ELEVEN_SOURCE_KEY = "7eleven_tw_freshfoods";
export const SEVEN_ELEVEN_SOURCE_LICENSE = "Official public product catalog; linked facts only";
export const SEVEN_ELEVEN_XML_BASE = "https://www.7-11.com.tw/freshfoods/Read_Food_xml_hot.aspx";

export const SEVEN_ELEVEN_CATEGORIES = [
  "19_star", "1_Ricerolls", "16_sandwich", "2_Light", "3_Cuisine", "4_Snacks",
  "5_ForeignDishes", "6_Noodles", "7_Oden", "8_Bigbite", "9_Icecream", "10_Slurpee",
  "11_bread", "hot", "12_steam", "13_luwei", "15_health", "17_ohlala", "18_veg",
  "20_panini", "21_ice", "22_ice",
] as const;

export interface SevenElevenCatalogCandidate {
  sourceKey: typeof SEVEN_ELEVEN_SOURCE_KEY;
  sourceRecordId: string;
  sourceUrl: string;
  sourceLicense: typeof SEVEN_ELEVEN_SOURCE_LICENSE;
  payloadSha256: string;
  canonicalKey: string;
  productName: string;
  brandName: "7-ELEVEN";
  categoryName: string;
  packageSpec: null;
  gtin: null;
  imageUrls: string[];
  ingredientsRaw: null;
  nutritionRaw: { caloriesPerItem: number | null; priceTwd: number | null; servingBasisVerified: false };
  evidenceTier: "catalog_only";
  nutritionAnalysisEligible: false;
  positiveBuyEligible: false;
  verificationStatus: "imported_unverified";
  aiEnrichmentStatus: "not_queued";
  qualityFlags: string[];
  rawPayload: Record<string, unknown>;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!match?.[1]) return null;
  const value = decodeXml(match[1]).replace(/<[^>]+>/g, "").trim();
  return value || null;
}

function finiteNumber(value: string | null): number | null {
  if (!value) return null;
  const number = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseSevenElevenCatalogXml(
  xml: string,
  categoryIndex: number,
): SevenElevenCatalogCandidate[] {
  const categoryName = SEVEN_ELEVEN_CATEGORIES[categoryIndex];
  if (!categoryName) throw new Error(`Unknown 7-ELEVEN category index: ${categoryIndex}`);
  const sourceUrl = `${SEVEN_ELEVEN_XML_BASE}?=${categoryIndex}`;
  const candidates: SevenElevenCatalogCandidate[] = [];
  const blocks = xml.match(/<Item\b[^>]*>[\s\S]*?<\/Item>/gi) ?? [];
  for (const block of blocks) {
    const productName = tag(block, "name");
    const imagePath = tag(block, "image");
    if (!productName) continue;
    const canonicalKey = sha256(`7eleven|${productName.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")}`);
    const sourceRecordId = sha256(`${categoryName}|${imagePath ?? ""}|${productName}`).slice(0, 32);
    const imageUrl = imagePath
      ? new URL(imagePath.replace(/^\//, ""), `https://www.7-11.com.tw/freshfoods/${categoryName}/`).toString()
      : null;
    const calories = finiteNumber(tag(block, "kcal"));
    const priceTwd = finiteNumber(tag(block, "price"));
    const rawPayload = {
      productName,
      categoryIndex,
      categoryName,
      calories,
      priceTwd,
      imagePath,
      content: tag(block, "content"),
      isNew: tag(block, "new") === "True",
    };
    candidates.push({
      sourceKey: SEVEN_ELEVEN_SOURCE_KEY,
      sourceRecordId,
      sourceUrl,
      sourceLicense: SEVEN_ELEVEN_SOURCE_LICENSE,
      payloadSha256: sha256(JSON.stringify(rawPayload)),
      canonicalKey,
      productName,
      brandName: "7-ELEVEN",
      categoryName,
      packageSpec: null,
      gtin: null,
      imageUrls: imageUrl ? [imageUrl] : [],
      ingredientsRaw: null,
      nutritionRaw: { caloriesPerItem: calories, priceTwd, servingBasisVerified: false },
      evidenceTier: "catalog_only",
      nutritionAnalysisEligible: false,
      positiveBuyEligible: false,
      verificationStatus: "imported_unverified",
      aiEnrichmentStatus: "not_queued",
      qualityFlags: [
        "official_7eleven_catalog_identity",
        "missing_gtin_requires_package_match",
        "calories_not_score_eligible_without_serving_basis",
        !imageUrl ? "missing_product_image" : null,
      ].filter((value): value is string => Boolean(value)),
      rawPayload,
    });
  }
  return candidates;
}

export function summarizeSevenElevenCatalog(candidates: SevenElevenCatalogCandidate[]) {
  const uniqueNames = new Set(candidates.map(candidate => candidate.canonicalKey)).size;
  return {
    accepted: candidates.length,
    uniqueNames,
    duplicateNameRows: candidates.length - uniqueNames,
    withImages: candidates.filter(candidate => candidate.imageUrls.length > 0).length,
    withCalories: candidates.filter(candidate => candidate.nutritionRaw.caloriesPerItem != null).length,
    withPrices: candidates.filter(candidate => candidate.nutritionRaw.priceTwd != null).length,
    withGtins: 0,
    nutritionAnalysisEligible: 0,
  };
}
