import { Router, type IRouter } from "express";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  alternativeProductLinksTable,
  barcodesTable,
  brandsTable,
  categoriesTable,
  nutritionFactsTable,
  productEvaluationsTable,
  productRetailerPricesTable,
  productsTable,
  retailersTable,
} from "@workspace/db";
import { GetAlternativesParams } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { RULESET_VERSION, type NutritionInput } from "../lib/scoring.js";
import { resolveCatalogProduct } from "../lib/catalogEvidence.js";
import {
  buildShoppingLinks,
  compareCandidateNutrition,
  extractDiscoveryTerms,
  nutritionInputFromRaw,
  sanitizeCommerceBrand,
  sanitizeCommerceCandidates,
  type CommerceCandidate,
} from "../lib/alternativeDiscovery.js";

const router: IRouter = Router();

type ProductRow = typeof productsTable.$inferSelect;

interface AlternativeResult {
  product: {
    id: number;
    name: string;
    nameZh: string | null;
    brandName: string | null;
    imageUrl: string | null;
    categorySlug: string | null;
    categoryName: string | null;
    verificationStatus: string;
    overallScore: number | null;
    scoreGrade: string | null;
    barcode: string | null;
    retailerName: string | null;
    priceNtd: number | null;
  };
  scoreImprovement: number | null;
  whyBetter: string;
  whyBetterZh: string | null;
  priceDifferenceNtd: number | null;
  sameRetailer: boolean;
}

const commerceCache = new Map<string, {
  expiresAt: number;
  status: "complete" | "no_results" | "unavailable" | "disabled";
  candidates: CommerceCandidate[];
}>();
const ALTERNATIVE_DISCOVERY_TIMEOUT_MS = 45_000;
const TRANSIENT_DISCOVERY_FAILURE_CACHE_MS = 2 * 60 * 1000;

function numeric(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nutritionInput(row: typeof nutritionFactsTable.$inferSelect | null | undefined): NutritionInput | null {
  if (!row) return null;
  return nutritionInputFromRaw({
    servingSize: row.servingSize,
    servingSizeUnit: row.servingSizeUnit,
    calories: row.calories,
    protein: row.protein,
    totalFat: row.totalFat,
    saturatedFat: row.saturatedFat,
    transFat: row.transFat,
    totalCarbs: row.totalCarbs,
    dietaryFiber: row.dietaryFiber,
    totalSugars: row.totalSugars,
    sodium: row.sodium,
  });
}

async function summarizeVerifiedProduct(product: ProductRow): Promise<AlternativeResult["product"] | null> {
  const [brand] = product.brandId
    ? await db.select().from(brandsTable).where(eq(brandsTable.id, product.brandId))
    : [null];
  const [category] = product.categoryId
    ? await db.select().from(categoriesTable).where(eq(categoriesTable.id, product.categoryId))
    : [null];
  const [barcode] = await db.select().from(barcodesTable)
    .where(eq(barcodesTable.productId, product.id)).limit(1);
  const [priceRow] = await db.select({
    priceNtd: productRetailerPricesTable.priceNtd,
    retailerId: productRetailerPricesTable.retailerId,
  }).from(productRetailerPricesTable)
    .where(eq(productRetailerPricesTable.productId, product.id)).limit(1);
  const [retailer] = priceRow?.retailerId
    ? await db.select().from(retailersTable).where(eq(retailersTable.id, priceRow.retailerId))
    : [null];
  const [evalRow] = await db.select({
    overallScore: productEvaluationsTable.overallScore,
    scoreGrade: productEvaluationsTable.scoreGrade,
    rulesetVersion: productEvaluationsTable.rulesetVersion,
  }).from(productEvaluationsTable)
    .where(eq(productEvaluationsTable.productId, product.id))
    .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);

  const presentation = resolveCatalogProduct(product, barcode?.barcode, brand);
  if (presentation.verificationStatus !== "verified") return null;
  const canShowScore = evalRow?.rulesetVersion === RULESET_VERSION;

  return {
    id: product.id,
    name: presentation.name,
    nameZh: presentation.nameZh,
    brandName: presentation.brandName,
    imageUrl: presentation.imageUrl,
    categorySlug: category?.slug ?? null,
    categoryName: category?.nameZh ?? category?.name ?? null,
    verificationStatus: presentation.verificationStatus,
    overallScore: canShowScore ? evalRow.overallScore : null,
    scoreGrade: canShowScore ? evalRow.scoreGrade : null,
    barcode: presentation.barcode,
    retailerName: retailer?.name ?? null,
    priceNtd: numeric(priceRow?.priceNtd),
  };
}

async function getLinkedAlternatives(productId: number): Promise<AlternativeResult[]> {
  const links = await db.select().from(alternativeProductLinksTable)
    .where(eq(alternativeProductLinksTable.productId, productId));

  const results = await Promise.all(links.map(async link => {
    const [altProduct] = await db.select().from(productsTable)
      .where(eq(productsTable.id, link.alternativeProductId));
    if (!altProduct) return null;
    const product = await summarizeVerifiedProduct(altProduct);
    if (!product) return null;

    return {
      product,
      scoreImprovement: link.scoreImprovement,
      whyBetter: link.whyBetter,
      whyBetterZh: link.whyBetterZh,
      priceDifferenceNtd: numeric(link.priceDifferenceNtd),
      sameRetailer: link.sameRetailer === "true",
    } satisfies AlternativeResult;
  }));

  return results.filter((item): item is AlternativeResult => Boolean(item));
}

async function getAutomaticVerifiedAlternatives(
  original: ProductRow,
  existing: AlternativeResult[],
): Promise<AlternativeResult[]> {
  if (!original.categoryId) return existing;
  const [originalEvaluation] = await db.select({
    overallScore: productEvaluationsTable.overallScore,
    rulesetVersion: productEvaluationsTable.rulesetVersion,
  }).from(productEvaluationsTable)
    .where(eq(productEvaluationsTable.productId, original.id))
    .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);
  if (originalEvaluation?.rulesetVersion !== RULESET_VERSION) return existing;

  const products = await db.select().from(productsTable).where(and(
    eq(productsTable.categoryId, original.categoryId),
    eq(productsTable.verificationStatus, "verified"),
    ne(productsTable.id, original.id),
  )).limit(30);
  const existingIds = new Set(existing.map(item => item.product.id));
  const automatic = await Promise.all(products.map(async product => {
    if (existingIds.has(product.id)) return null;
    const summary = await summarizeVerifiedProduct(product);
    if (!summary || summary.overallScore == null || summary.overallScore <= originalEvaluation.overallScore) return null;
    const improvement = summary.overallScore - originalEvaluation.overallScore;
    return {
      product: summary,
      scoreImprovement: improvement,
      whyBetter: `FACTA's current verified score is ${improvement} points higher in the same product category.`,
      whyBetterZh: `同一商品類別中，依目前已驗證資料，FACTA 分數高 ${improvement} 分。`,
      priceDifferenceNtd: null,
      sameRetailer: false,
    } satisfies AlternativeResult;
  }));

  const automaticResults = automatic.filter(
    (item): item is Exclude<(typeof automatic)[number], null> => item !== null,
  );
  return [...existing, ...automaticResults]
    .sort((a, b) => (b.scoreImprovement ?? 0) - (a.scoreImprovement ?? 0))
    .slice(0, 6);
}

async function getCatalogCount(): Promise<number> {
  try {
    const result = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM catalog_import_candidates
      WHERE verification_status IN ('imported_unverified', 'pending_review')
    `);
    const rows = (result as any).rows ?? result;
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

async function discoverCatalogCandidates(
  original: ProductRow,
  terms: string[],
): Promise<Array<Record<string, unknown>>> {
  if (terms.length === 0) return [];
  const [originalNutritionRow] = await db.select().from(nutritionFactsTable)
    .where(eq(nutritionFactsTable.productId, original.id)).limit(1);
  const originalNutrition = nutritionInput(originalNutritionRow);
  const termConditions = terms.map(term => {
    const pattern = `%${term.slice(0, 100)}%`;
    return sql`(product_name ILIKE ${pattern} OR category_name ILIKE ${pattern})`;
  });
  const candidates: Array<Record<string, unknown> & { sourcePriority?: number }> = [];

  // Retailer seed rows are valuable for the user's immediate "where can I buy
  // it" question. They remain identity-only until a physical label is checked.
  try {
    const retailerTermConditions = terms.map(term => {
      const pattern = `%${term.slice(0, 100)}%`;
      return sql`(product_name ILIKE ${pattern} OR category_normalized ILIKE ${pattern})`;
    });
    const retailerResult = await db.execute(sql`
      SELECT facta_seed_id, product_name, brand_raw, retailer,
             category_normalized, spec_raw, price_twd, image_url, source_url
      FROM facta_catalog_seed
      WHERE ${sql.join(retailerTermConditions, sql` OR `)}
      ORDER BY catalog_completeness_score DESC NULLS LAST, product_name
      LIMIT 12
    `);
    const retailerRows = ((retailerResult as any).rows ?? retailerResult) as Array<Record<string, any>>;
    for (const row of retailerRows) {
      const brandName = sanitizeCommerceBrand(row.brand_raw);
      const shoppingLinks = buildShoppingLinks(row.product_name, brandName);
      const sourceUrl = typeof row.source_url === "string" && /^https?:\/\//i.test(row.source_url)
        ? row.source_url
        : shoppingLinks[0]!.url;
      candidates.push({
        candidateId: `retailer:${row.facta_seed_id}`,
        name: row.product_name,
        brandName,
        imageUrl: row.image_url ?? null,
        categoryName: row.category_normalized ?? null,
        packageSpec: row.spec_raw ?? null,
        retailerName: row.retailer ?? null,
        priceNtd: numeric(row.price_twd),
        sourceName: `${row.retailer ?? "零售通路"}公開商品頁`,
        sourceUrl,
        evidenceTier: "catalog_only",
        verificationStatus: "needs_label_check",
        comparisonStatus: "identity_only",
        preliminaryNutritionScore: null,
        scoreDelta: null,
        preliminaryBetter: false,
        whyCandidateZh: [`通路商品名稱符合「${terms[0]}」同類搜尋；價格與庫存以商品頁當下顯示為準。`],
        shoppingLinks,
        sourcePriority: 1,
      });
    }
  } catch {
    // Retailer seed is an optional source; the source-backed import remains available.
  }

  try {
    const result = await db.execute(sql`
      SELECT source_key, source_record_id, source_url, product_name, brand_name,
             category_name, package_spec, image_urls, nutrition_raw, evidence_tier
      FROM catalog_import_candidates
      WHERE verification_status IN ('imported_unverified', 'pending_review')
        AND (${sql.join(termConditions, sql` OR `)})
      ORDER BY
        CASE evidence_tier
          WHEN 'review_ready' THEN 0
          WHEN 'nutrition_ready' THEN 1
          WHEN 'ingredients_ready' THEN 2
          ELSE 3
        END,
        nutrition_analysis_eligible DESC,
        updated_at DESC
      LIMIT 24
    `);
    const rows = ((result as any).rows ?? result) as Array<Record<string, any>>;
    for (const row of rows) {
      const brandName = sanitizeCommerceBrand(row.brand_name);
      const candidateNutrition = nutritionInputFromRaw(row.nutrition_raw);
      const comparison = compareCandidateNutrition(originalNutrition, candidateNutrition);
      const imageUrls = Array.isArray(row.image_urls)
        ? row.image_urls.filter((item: unknown): item is string => typeof item === "string")
        : [];
      const sourceName = row.source_key === "tfda_food_traceability_188"
        ? "食藥署食品追溯公開資料"
        : row.source_key === "open_food_facts"
          ? "Open Food Facts"
          : "公開商品資料";
      const whyCandidateZh = comparison.reasonsZh.length > 0
        ? comparison.reasonsZh
        : [`商品名稱符合「${terms[0]}」同類搜尋；需再核對現售包裝。`];

      candidates.push({
        candidateId: `${row.source_key}:${row.source_record_id}`,
        name: row.product_name,
        brandName,
        imageUrl: imageUrls[0] ?? null,
        categoryName: row.category_name ?? null,
        packageSpec: row.package_spec ?? null,
        sourceName,
        sourceUrl: row.source_url,
        evidenceTier: row.evidence_tier ?? "catalog_only",
        verificationStatus: "needs_label_check",
        ...comparison,
        whyCandidateZh,
        shoppingLinks: buildShoppingLinks(row.product_name, brandName),
        sourcePriority: 0,
      });
    }
  } catch {
    // The imported source migration is optional during staged rollouts.
  }

  const deduped = new Map<string, Record<string, unknown> & { sourcePriority?: number }>();
  for (const candidate of candidates) {
    const key = `${String(candidate.brandName ?? "")}｜${String(candidate.name)}`.normalize("NFKC").toLowerCase();
    if (!deduped.has(key)) deduped.set(key, candidate);
  }
  return [...deduped.values()]
    .sort((a, b) => Number(b.preliminaryBetter) - Number(a.preliminaryBetter)
      || Number(b.scoreDelta ?? -999) - Number(a.scoreDelta ?? -999)
      || Number(b.sourcePriority ?? 0) - Number(a.sourcePriority ?? 0))
    .slice(0, 8)
    .map(({ sourcePriority: _sourcePriority, ...candidate }) => candidate);
}

function jsonObjectFromText(value: string): Record<string, unknown> {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(value.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function discoverCommerceCandidates(input: {
  productName: string;
  brandName: string | null;
  categoryName: string | null;
  terms: string[];
}): Promise<{
  status: "complete" | "no_results" | "unavailable" | "disabled";
  candidates: CommerceCandidate[];
}> {
  if (process.env.FACTA_ALTERNATIVE_WEB_SEARCH_ENABLED === "false") {
    return { status: "disabled", candidates: [] };
  }
  const query = input.terms.join(" ") || input.categoryName || input.productName;
  const cacheKey = query.normalize("NFKC").toLowerCase();
  const cached = commerceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ALTERNATIVE_DISCOVERY_TIMEOUT_MS);
  try {
    const response = await (openai as any).responses.create({
      model: "gpt-5.6-terra",
      reasoning: { effort: "low" },
      tools: [{ type: "web_search" }],
      input: `Today is ${new Date().toISOString().slice(0, 10)}. Search current Taiwan ecommerce product pages for up to 6 products in the same product family as the item below.

Original product: ${input.productName}
Original brand: ${input.brandName ?? "unknown"}
Known category: ${input.categoryName ?? "unknown"}
Product-family terms: ${input.terms.join(", ") || "infer conservatively from the product name"}

Requirements:
- Search momo, PChome, Shopee Taiwan, Carrefour Taiwan, PXGo, Costco Taiwan, ETMall, Watsons Taiwan, Cosmed, Books.com.tw, Rakuten Taiwan, and Ruten.
- Return only a direct, currently discoverable product page on one of those domains. Do not return a search-result page, article, social post, or aggregator.
- The candidate must be the same product family and use case. Do not mix probiotic supplements with yogurt, water with flavored drinks, or snacks with meal replacements.
- Do not claim a product is healthier or better. Ecommerce identity, price and availability are only discovery evidence; FACTA will separately verify the package label.
- If a price is not clearly shown, use null. Do not invent a brand, price, URL, or health claim.

Return ONLY this JSON object:
{
  "candidates": [{
    "name": "exact listing name",
    "brandName": "brand or null",
    "retailerName": "retailer",
    "priceNtd": 699,
    "productUrl": "https://direct-product-page",
    "whyMatchZh": "一句繁體中文，僅說明為何是同類商品，不做健康宣稱"
  }]
}`,
    }, { signal: controller.signal });
    const payload = jsonObjectFromText(String(response?.output_text ?? ""));
    const candidates = sanitizeCommerceCandidates(payload.candidates);
    const value = {
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      status: candidates.length > 0 ? "complete" as const : "no_results" as const,
      candidates,
    };
    if (commerceCache.size >= 200) commerceCache.delete(commerceCache.keys().next().value ?? "");
    commerceCache.set(cacheKey, value);
    return value;
  } catch (error) {
    const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
    console.warn("[FACTA] alternative commerce discovery unavailable", {
      query,
      name: typeof detail.name === "string" ? detail.name : undefined,
      status: typeof detail.status === "number" ? detail.status : undefined,
      code: typeof detail.code === "string" ? detail.code : undefined,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    const value = {
      expiresAt: Date.now() + TRANSIENT_DISCOVERY_FAILURE_CACHE_MS,
      status: "unavailable" as const,
      candidates: [],
    };
    commerceCache.set(cacheKey, value);
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

router.get("/alternatives/:productId/discover", async (req, res): Promise<void> => {
  const params = GetAlternativesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [original] = await db.select().from(productsTable)
    .where(eq(productsTable.id, params.data.productId));
  if (!original) { res.status(404).json({ error: "Product not found" }); return; }
  const [brand] = original.brandId
    ? await db.select().from(brandsTable).where(eq(brandsTable.id, original.brandId))
    : [null];
  const [category] = original.categoryId
    ? await db.select().from(categoriesTable).where(eq(categoriesTable.id, original.categoryId))
    : [null];
  const originalLabel = original.nameZh ?? original.name;
  const categoryLabel = category?.nameZh ?? category?.name ?? null;
  const terms = extractDiscoveryTerms({
    productName: originalLabel,
    brandName: brand?.nameZh ?? brand?.name ?? null,
    categoryName: categoryLabel,
  });

  const linked = await getLinkedAlternatives(original.id);
  const [verifiedAlternatives, catalogCandidates, catalogCount, commerce] = await Promise.all([
    getAutomaticVerifiedAlternatives(original, linked),
    discoverCatalogCandidates(original, terms),
    getCatalogCount(),
    discoverCommerceCandidates({
      productName: originalLabel,
      brandName: brand?.nameZh ?? brand?.name ?? null,
      categoryName: categoryLabel,
      terms,
    }),
  ]);

  const status = verifiedAlternatives.length > 0
    ? "verified_found"
    : catalogCandidates.length > 0 || commerce.candidates.length > 0
      ? "candidates_found"
      : "no_candidates";

  res.json({
    status,
    query: terms.join(" ") || originalLabel,
    searchedAt: new Date().toISOString(),
    catalogCount,
    webSearchStatus: commerce.status,
    verifiedAlternatives,
    catalogCandidates,
    commerceCandidates: commerce.candidates.map(candidate => ({
      ...candidate,
      verificationStatus: "listing_only",
      shoppingLinks: buildShoppingLinks(candidate.name, candidate.brandName),
    })),
    caveatZh: "電商頁只能證明商品正在被販售，不能證明比較健康。FACTA 只會把同類商品列為候選；包裝標示核對完成前，不下「可以買」結論。",
  });
});

router.get("/alternatives/:productId", async (req, res): Promise<void> => {
  const params = GetAlternativesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  res.json(await getLinkedAlternatives(params.data.productId));
});

export default router;
