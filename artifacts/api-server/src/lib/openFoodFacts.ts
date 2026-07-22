import { createHash } from "node:crypto";
import { pool } from "@workspace/db";

const OFF_API_BASE = "https://world.openfoodfacts.org/api/v3/product";
const OFF_SOURCE_KEY = "open_food_facts";
const OFF_LICENSE = "Open Database License (ODbL) 1.0";

type OffProduct = {
  product_name?: string;
  product_name_zh?: string;
  brands?: string;
  image_front_url?: string;
  image_url?: string;
  ingredients_text?: string;
  ingredients_text_zh?: string;
  nutrition_data_per?: string;
  nutriments?: Record<string, unknown>;
  categories?: string;
  quantity?: string;
};

type OffResponse = {
  status?: string;
  code?: string;
  product?: OffProduct;
};

export interface ExternalBarcodeCandidate {
  barcode: string;
  productName: string;
  productNameZh: string | null;
  brandName: string | null;
  imageUrl: string | null;
  evidenceTier: "catalog_only" | "nutrition_ready" | "ingredients_ready" | "review_ready";
  sourceName: "Open Food Facts";
  sourceUrl: string;
  verificationStatus: "external_unverified";
}

const lookupCache = new Map<string, { expiresAt: number; value: { candidate: ExternalBarcodeCandidate; rawProduct: OffProduct } | null }>();

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\-_·・|｜()（）\[\]【】]/g, "");
}

function normalizedNutrition(product: OffProduct) {
  const nutriments = product.nutriments ?? {};
  const basis = product.nutrition_data_per === "100ml" ? "per_100ml" : "per_100g";
  const sodiumGrams = number(nutriments["sodium_100g"]);
  const normalized = {
    basis,
    servingSize: 100,
    servingSizeUnit: basis === "per_100ml" ? "ml" : "g",
    calories: number(nutriments["energy-kcal_100g"]),
    protein: number(nutriments["proteins_100g"]),
    totalFat: number(nutriments["fat_100g"]),
    saturatedFat: number(nutriments["saturated-fat_100g"]),
    transFat: number(nutriments["trans-fat_100g"]),
    totalCarbs: number(nutriments["carbohydrates_100g"]),
    totalSugars: number(nutriments["sugars_100g"]),
    sodium: sodiumGrams == null ? null : Math.round(sodiumGrams * 1000 * 100) / 100,
  };
  const criticalCount = [normalized.totalSugars, normalized.sodium, normalized.saturatedFat]
    .filter(value => value != null).length;
  return criticalCount >= 2 ? normalized : null;
}

function sourceUrl(barcode: string): string {
  return `https://world.openfoodfacts.org/product/${barcode}`;
}

export async function lookupOpenFoodFacts(barcode: string): Promise<{ candidate: ExternalBarcodeCandidate; rawProduct: OffProduct } | null> {
  if (process.env.FACTA_EXTERNAL_CATALOG_LOOKUP_ENABLED === "false") return null;
  const cached = lookupCache.get(barcode);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const fields = [
      "code", "product_name", "product_name_zh", "brands", "image_front_url", "image_url",
      "ingredients_text", "ingredients_text_zh", "nutrition_data_per", "nutriments", "categories", "quantity",
    ].join(",");
    const response = await fetch(`${OFF_API_BASE}/${encodeURIComponent(barcode)}.json?fields=${fields}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": process.env.OPEN_FOOD_FACTS_USER_AGENT ?? "FACTA/1.0 (https://facta.replit.app)",
      },
    });
    if (response.status === 404) {
      lookupCache.set(barcode, { expiresAt: Date.now() + 60 * 60 * 1000, value: null });
      return null;
    }
    if (!response.ok) throw new Error(`Open Food Facts lookup failed: HTTP ${response.status}`);
    const payload = await response.json() as OffResponse;
    const product = payload.product;
    const productName = text(product?.product_name_zh) ?? text(product?.product_name);
    if (payload.status !== "success" || !product || !productName) {
      lookupCache.set(barcode, { expiresAt: Date.now() + 60 * 60 * 1000, value: null });
      return null;
    }

    const ingredients = text(product.ingredients_text_zh) ?? text(product.ingredients_text);
    const nutrition = normalizedNutrition(product);
    const evidenceTier: ExternalBarcodeCandidate["evidenceTier"] = nutrition && ingredients
      ? "review_ready"
      : nutrition
        ? "nutrition_ready"
        : ingredients
          ? "ingredients_ready"
          : "catalog_only";
    const result: { candidate: ExternalBarcodeCandidate; rawProduct: OffProduct } = {
      candidate: {
        barcode,
        productName: text(product.product_name) ?? productName,
        productNameZh: text(product.product_name_zh),
        brandName: text(product.brands)?.split(",")[0]?.trim() || null,
        imageUrl: text(product.image_front_url) ?? text(product.image_url),
        evidenceTier,
        sourceName: "Open Food Facts",
        sourceUrl: sourceUrl(barcode),
        verificationStatus: "external_unverified",
      },
      rawProduct: product,
    };
    if (lookupCache.size >= 500) lookupCache.delete(lookupCache.keys().next().value ?? "");
    lookupCache.set(barcode, { expiresAt: Date.now() + 24 * 60 * 60 * 1000, value: result });
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function lookupStagedBarcodeCandidate(barcode: string): Promise<ExternalBarcodeCandidate | null> {
  try {
    const result = await pool.query<{
      product_name: string;
      brand_name: string | null;
      image_urls: unknown;
      evidence_tier: ExternalBarcodeCandidate["evidenceTier"];
      source_url: string;
    }>(`
      select product_name, brand_name, image_urls, evidence_tier, source_url
      from catalog_import_candidates
      where gtin = $1
        and verification_status in ('imported_unverified', 'pending_review')
      order by case evidence_tier
        when 'review_ready' then 0
        when 'nutrition_ready' then 1
        when 'ingredients_ready' then 2
        else 3
      end
      limit 1
    `, [barcode]);
    const row = result.rows[0];
    if (!row) return null;
    const images = Array.isArray(row.image_urls) ? row.image_urls.filter((item): item is string => typeof item === "string") : [];
    return {
      barcode,
      productName: row.product_name,
      productNameZh: row.product_name,
      brandName: row.brand_name,
      imageUrl: images[0] ?? null,
      evidenceTier: row.evidence_tier,
      sourceName: "Open Food Facts",
      sourceUrl: row.source_url,
      verificationStatus: "external_unverified",
    };
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}

/** Cache an external hit in the unverified staging table; never create a scored product here. */
export async function stageOpenFoodFactsCandidate(
  result: Awaited<ReturnType<typeof lookupOpenFoodFacts>>,
): Promise<void> {
  if (!result || process.env.FACTA_STAGE_EXTERNAL_CATALOG_ENABLED === "false") return;
  const { candidate, rawProduct } = result;
  const ingredients = text(rawProduct.ingredients_text_zh) ?? text(rawProduct.ingredients_text);
  const nutrition = normalizedNutrition(rawProduct);
  const rawPayload = { code: candidate.barcode, product: rawProduct };
  const payloadSha256 = sha256(JSON.stringify(rawPayload));
  const canonicalKey = sha256([
    candidate.brandName,
    candidate.productNameZh ?? candidate.productName,
    text(rawProduct.quantity),
  ].map(value => normalizeIdentity(value ?? "")).join("|"));
  const imageUrls = [candidate.imageUrl].filter((value): value is string => Boolean(value));

  await pool.query(`
    insert into catalog_import_candidates (
      source_key, source_record_id, source_url, source_license,
      payload_sha256, canonical_key, product_name, brand_name, category_name,
      package_spec, gtin, traceability_code, image_urls, ingredients_raw,
      nutrition_raw, evidence_tier, nutrition_analysis_eligible,
      positive_buy_eligible, verification_status, ai_enrichment_status,
      quality_flags, raw_payload, first_seen_at, last_seen_at, updated_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, null,
      $12::jsonb, $13, $14::jsonb, $15, $16, false,
      'imported_unverified', 'not_queued', $17::jsonb, $18::jsonb,
      now(), now(), now()
    )
    on conflict (source_key, source_record_id) do update set
      source_url = excluded.source_url,
      payload_sha256 = excluded.payload_sha256,
      canonical_key = excluded.canonical_key,
      product_name = excluded.product_name,
      brand_name = excluded.brand_name,
      category_name = excluded.category_name,
      package_spec = excluded.package_spec,
      gtin = excluded.gtin,
      image_urls = excluded.image_urls,
      ingredients_raw = excluded.ingredients_raw,
      nutrition_raw = excluded.nutrition_raw,
      evidence_tier = excluded.evidence_tier,
      nutrition_analysis_eligible = excluded.nutrition_analysis_eligible,
      quality_flags = excluded.quality_flags,
      raw_payload = excluded.raw_payload,
      last_seen_at = now(),
      updated_at = now()
  `, [
    OFF_SOURCE_KEY,
    candidate.barcode,
    candidate.sourceUrl,
    OFF_LICENSE,
    payloadSha256,
    canonicalKey,
    candidate.productNameZh ?? candidate.productName,
    candidate.brandName,
    text(rawProduct.categories),
    text(rawProduct.quantity),
    candidate.barcode,
    JSON.stringify(imageUrls),
    ingredients,
    JSON.stringify({ normalized: nutrition, sourceFields: rawProduct.nutriments ?? {} }),
    candidate.evidenceTier,
    Boolean(nutrition),
    JSON.stringify([
      "community_contributed_source_not_facta_verified",
      "gtin_identity_from_open_food_facts",
      nutrition ? "nutrition_pending_facta_verification" : "missing_score_eligible_nutrition",
    ]),
    JSON.stringify(rawPayload),
  ]);
}
