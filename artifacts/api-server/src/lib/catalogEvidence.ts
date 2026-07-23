import type { NutritionInput } from "./scoring.js";
import { isValidRetailGtin } from "./barcodeIdentity.js";

/**
 * Source-backed corrections for legacy demo rows.
 *
 * These records intentionally live in code instead of mutating production data:
 * they are reviewable, reversible, and keep every corrected identity tied to a
 * directly inspectable retailer source. Legacy rows without this level of
 * evidence are downgraded and must not show a product photo or numeric score.
 */

export interface CatalogProductLike {
  id: number;
  name: string;
  nameZh: string | null;
  imageUrl: string | null;
  ingredientsList: string | null;
  verificationStatus: string;
  brandId?: number | null;
}

export interface CatalogBrandLike {
  name?: string | null;
  nameZh?: string | null;
}

export interface CatalogAllergen {
  name: string;
  nameZh: string;
  severity: "moderate" | "high";
  source: string;
}

export interface TrustedProductEvidence {
  productId: number;
  expectedLegacyNames: string[];
  name: string;
  nameZh: string;
  brandName: string;
  brandNameZh: string;
  netWeight: string;
  barcode: string;
  imageUrl: string;
  productSourceUrl: string;
  barcodeSourceUrl: string;
  imageSourceUrl: string;
  ingredientsList: string;
  nutrition: NutritionInput | null;
  allergens: CatalogAllergen[];
}

export interface ResolvedCatalogProduct {
  name: string;
  nameZh: string | null;
  brandName: string | null;
  imageUrl: string | null;
  barcode: string | null;
  ingredientsList: string | null;
  verificationStatus: string;
  evidence: TrustedProductEvidence | null;
}

export const CATALOG_EVIDENCE_VERSION = "2026-07-22";
export const CATALOG_EVIDENCE_UPDATED_AT = new Date(
  "2026-07-22T09:59:00+08:00",
);

const LEGACY_SEED_PRODUCT_IDS = new Set([1, 2, 3, 4, 5, 6]);

const TRUSTED_PRODUCT_EVIDENCE: TrustedProductEvidence[] = [
  {
    productId: 11,
    expectedLegacyNames: [
      "統一PH9.0鹼性離子水",
      "統一PH9.0鹼性離子水 800ml",
    ],
    name: "Uni-President PH9.0 Alkaline Ionized Water 800ml",
    nameZh: "統一PH9.0鹼性離子水 800ml",
    brandName: "Uni-President",
    brandNameZh: "統一",
    netWeight: "800ml",
    barcode: "4710088637574",
    imageUrl: "https://www.pecos.com.tw/tmp/image/20140402/20140402195619_58489.jpg",
    productSourceUrl: "https://www.pecos.com.tw/brands-%E7%B5%B1%E4%B8%80PH9.0.html",
    barcodeSourceUrl: "https://shop.pxgo.com.tw/hourArrive/goods/251137-06130059-4710088637574",
    imageSourceUrl: "https://www.pecos.com.tw/tmp/image/20140402/20140402195619_58489.jpg",
    ingredientsList: "水、海水濃縮礦物質液",
    nutrition: null,
    allergens: [],
  },
  {
    productId: 6,
    expectedLegacyNames: ["AGV Double Fiber Barley Tea", "愛之味雙纖麥仔茶"],
    name: "AGV Double Fiber Barley Tea 590ml",
    nameZh: "愛之味 分解茶雙纖麥茶 590ml",
    brandName: "AGV",
    brandNameZh: "愛之味",
    netWeight: "590ml",
    barcode: "4710626255314",
    imageUrl: "https://img-pxbox.es.pxmart.com.tw/240925000062448001.jpg",
    productSourceUrl: "https://pxbox.es.pxmart.com.tw/product/154648",
    barcodeSourceUrl:
      "https://www.foodpanda.com.tw/shop/ypju/quan-jia-bian-li-shang-dian-gao-xiong-chang-mei-dian",
    imageSourceUrl: "https://img-pxbox.es.pxmart.com.tw/240925000062448001.jpg",
    ingredientsList:
      "水、大麥、難消化性麥芽糊精、菊苣纖維、決明子、L-抗壞血酸鈉（抗氧化劑）、沖繩久米島海洋深層水濃縮液、碳酸氫鈉（小蘇打）",
    nutrition: {
      servingSize: 100,
      servingSizeUnit: "ml",
      calories: 4.6,
      totalFat: 0,
      saturatedFat: 0,
      transFat: 0,
      sodium: 14,
      totalCarbs: 2,
      dietaryFiber: 1.7,
      totalSugars: 0,
      protein: 0,
    },
    allergens: [
      {
        name: "Gluten-containing grains",
        nameZh: "含麩質之穀物",
        severity: "high",
        source: "retailer_label",
      },
    ],
  },
  {
    productId: 4,
    expectedLegacyNames: ["Want Want Rice Crackers", "旺旺仙貝"],
    name: "Want Want Senbei Rice Crackers 112g",
    nameZh: "旺旺仙貝米果 112g（2枚×20袋）",
    brandName: "Want Want",
    brandNameZh: "旺旺",
    netWeight: "112g",
    barcode: "4710144201206",
    imageUrl:
      "https://image.pxgo.com.tw/pic/2025/08/27/452c3d14bf71405886165e9b24c08105.jpg",
    productSourceUrl:
      "https://shop.pxgo.com.tw/hourArrive/goods/246614-20464773-4710144201206",
    barcodeSourceUrl:
      "https://shop.pxgo.com.tw/hourArrive/goods/246614-20464773-4710144201206",
    imageSourceUrl:
      "https://image.pxgo.com.tw/pic/2025/08/27/452c3d14bf71405886165e9b24c08105.jpg",
    ingredientsList:
      "白米、棕櫚油、蔗糖、玉米澱粉、葡萄糖、醬油粉（釀造醬油、麥芽糊精、食鹽、焦糖色素、琥珀酸二鈉、蔗糖、L-麩酸鈉、酵母抽出物、昆布抽出物、5'-次黃嘌呤核苷磷酸二鈉、5'-鳥嘌呤核苷磷酸二鈉）、食鹽、L-麩酸鈉",
    nutrition: {
      servingSize: 100,
      servingSizeUnit: "g",
      calories: 477,
      totalFat: 17.9,
      saturatedFat: 8.8,
      transFat: 0,
      sodium: 778,
      totalCarbs: 74.8,
      dietaryFiber: null,
      totalSugars: 14,
      protein: 4.2,
    },
    allergens: [
      {
        name: "Gluten-containing grains",
        nameZh: "含麩質之穀物",
        severity: "high",
        source: "retailer_label",
      },
      {
        name: "Soy",
        nameZh: "大豆",
        severity: "high",
        source: "retailer_label",
      },
    ],
  },
];

const TRUSTED_BY_ID = new Map(
  TRUSTED_PRODUCT_EVIDENCE.map((item) => [item.productId, item]),
);
const TRUSTED_BY_BARCODE = new Map(
  TRUSTED_PRODUCT_EVIDENCE.map((item) => [item.barcode, item]),
);

function normalizedName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[\s\-_·・|｜()（）]/g, "");
}

export function isGenericCatalogImage(url: string | null | undefined): boolean {
  if (!url) return false;
  return /images\.unsplash\.com|source\.unsplash\.com/i.test(url);
}

export function isLegacySeedProduct(
  product: Pick<CatalogProductLike, "id">,
): boolean {
  return LEGACY_SEED_PRODUCT_IDS.has(product.id);
}

export function getTrustedProductEvidence(
  product: Pick<CatalogProductLike, "id" | "name" | "nameZh">,
): TrustedProductEvidence | null {
  const evidence = TRUSTED_BY_ID.get(product.id);
  if (!evidence) return null;

  const currentNames = [
    normalizedName(product.name),
    normalizedName(product.nameZh),
  ].filter(Boolean);
  const expectedNames = evidence.expectedLegacyNames.map(normalizedName);
  return currentNames.some((current) =>
    expectedNames.some((expected) => current === expected),
  )
    ? evidence
    : null;
}

export function getTrustedProductEvidenceByBarcode(
  barcode: string,
): TrustedProductEvidence | null {
  return TRUSTED_BY_BARCODE.get(barcode) ?? null;
}

export function resolveCatalogProduct(
  product: CatalogProductLike,
  rawBarcode: string | null | undefined,
  brand: CatalogBrandLike | null | undefined,
): ResolvedCatalogProduct {
  const evidence = getTrustedProductEvidence(product);
  if (evidence) {
    return {
      name: evidence.name,
      nameZh: evidence.nameZh,
      brandName: evidence.brandNameZh,
      imageUrl: evidence.imageUrl,
      barcode: evidence.barcode,
      ingredientsList: evidence.ingredientsList,
      verificationStatus: "verified",
      evidence,
    };
  }

  const legacyUnverified = isLegacySeedProduct(product);
  return {
    name: product.name,
    nameZh: product.nameZh,
    brandName: brand?.nameZh ?? brand?.name ?? null,
    imageUrl: isGenericCatalogImage(product.imageUrl) ? null : product.imageUrl,
    barcode: rawBarcode ?? null,
    ingredientsList: legacyUnverified ? null : product.ingredientsList,
    verificationStatus: legacyUnverified
      ? "catalog_unverified"
      : product.verificationStatus,
    evidence: null,
  };
}

export function isVerifiedCatalogProduct(
  product: ResolvedCatalogProduct,
): boolean {
  return product.verificationStatus === "verified";
}

/** Validate the printed check digit before looking up a retail GTIN. */
export function isValidGtin(value: string): boolean {
  return isValidRetailGtin(value);
}
