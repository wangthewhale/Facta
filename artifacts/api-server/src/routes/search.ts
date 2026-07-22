import { Router, type IRouter } from "express";
import { ilike, or, eq, and, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  productsTable, brandsTable, barcodesTable, categoriesTable,
  productEvaluationsTable, productRetailerPricesTable, retailersTable,
  userGoalsTable, userPreferencesTable, goalProductEvaluationsTable, goalsTable,
  guidesTable,
} from "@workspace/db";
import { SearchProductsQueryParams } from "@workspace/api-zod";
import { calculateGoalFit, GOAL_RULESET_VERSION } from "../lib/goalFit.js";
import { nutritionFactsTable } from "@workspace/db";
import { RULESET_VERSION } from "../lib/scoring.js";
import { resolveCatalogProduct } from "../lib/catalogEvidence.js";
import { expandCatalogSearchTerms, scoreCatalogCandidate } from "../lib/catalogDiscovery.js";
import { discoverLiveCatalog } from "../lib/liveCatalogDiscovery.js";

const router: IRouter = Router();

const LIVE_DISCOVERY_RATE_LIMIT = 24;
const LIVE_DISCOVERY_RATE_WINDOW_MS = 10 * 60 * 1000;
const liveDiscoveryRateBuckets = new Map<string, { count: number; resetAt: number }>();

function canDiscoverCatalog(clientId: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const current = liveDiscoveryRateBuckets.get(clientId);
  if (!current || current.resetAt <= now) {
    if (liveDiscoveryRateBuckets.size >= 5_000) {
      for (const [key, bucket] of liveDiscoveryRateBuckets) {
        if (bucket.resetAt <= now) liveDiscoveryRateBuckets.delete(key);
      }
      if (liveDiscoveryRateBuckets.size >= 5_000) {
        liveDiscoveryRateBuckets.delete(liveDiscoveryRateBuckets.keys().next().value ?? "");
      }
    }
    liveDiscoveryRateBuckets.set(clientId, { count: 1, resetAt: now + LIVE_DISCOVERY_RATE_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= LIVE_DISCOVERY_RATE_LIMIT) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

router.get("/search/discover", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.normalize("NFKC").trim() : "";
  if (!q || q.length > 120) {
    res.status(400).json({ error: "q must be between 1 and 120 characters" });
    return;
  }
  const rate = canDiscoverCatalog(req.ip || "unknown");
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSeconds));
    res.status(429).json({ error: "Too many live catalog searches. Please try again later." });
    return;
  }
  res.json(await discoverLiveCatalog(q));
});

/** Parse natural language query into structured filters (heuristic, no AI for V1) */
function parseNaturalLanguage(q: string) {
  const lq = q.toLowerCase();
  const filters: { retailerSlugs?: string[]; mealType?: string; goalSlug?: string; keywords: string[] } = { keywords: [] };

  // Retailer detection
  const retailerMap: Record<string, string> = {
    "7-eleven": "7eleven", "seven": "7eleven", "全家": "family-mart",
    "全聯": "pxmart", "家樂福": "carrefour", "costco": "costco",
  };
  for (const [term, slug] of Object.entries(retailerMap)) {
    if (lq.includes(term)) {
      filters.retailerSlugs = filters.retailerSlugs ?? [];
      filters.retailerSlugs.push(slug);
    }
  }

  // Meal type detection
  if (lq.match(/早餐|breakfast/)) filters.mealType = "breakfast";
  else if (lq.match(/午餐|lunch/)) filters.mealType = "lunch";
  else if (lq.match(/晚餐|dinner/)) filters.mealType = "dinner";
  else if (lq.match(/點心|snack/)) filters.mealType = "snack";

  // Goal detection
  if (lq.match(/蛋白質|protein/)) filters.goalSlug = "protein";
  else if (lq.match(/體脂|減重|fat/)) filters.goalSlug = "body_fat";
  else if (lq.match(/皮膚|skin/)) filters.goalSlug = "skin_health";

  // Remaining keywords for text search
  const cleanQ = q.replace(/7-eleven|seven|全家|全聯|家樂福|costco|早餐|午餐|晚餐|點心|蛋白質|protein|體脂|減重|皮膚|skin/gi, "").trim();
  if (cleanQ) filters.keywords = cleanQ.split(/\s+/).filter(Boolean);

  return filters;
}

router.get("/search", async (req, res): Promise<void> => {
  const parsed = SearchProductsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { q, goal_slug, meal_type, retailer_slug, session_id, limit = 20 } = parsed.data;

  // Parse natural language
  const nlFilters = parseNaturalLanguage(q);
  const effectiveGoalSlug = goal_slug ?? nlFilters.goalSlug;
  const effectiveMealType = meal_type ?? nlFilters.mealType;

  // Get user allergens if session provided
  let userAllergens: string[] = [];
  if (session_id) {
    const [prefs] = await db.select().from(userPreferencesTable)
      .where(eq(userPreferencesTable.sessionId, session_id));
    userAllergens = (prefs?.allergens as string[]) ?? [];
  }

  // Build text search — ONLY verified products are returned
  const searchTerms = [...new Set([
    ...expandCatalogSearchTerms(q),
    ...nlFilters.keywords.flatMap(expandCatalogSearchTerms),
  ].filter(Boolean))];
  const conditions = [eq(productsTable.verificationStatus, "verified")];

  if (searchTerms.length > 0) {
    const textConditions = searchTerms.flatMap(term => [
        ilike(productsTable.name, `%${term}%`),
        ilike(productsTable.nameZh, `%${term}%`),
        ilike(productsTable.ingredientsList, `%${term}%`),
    ]);
    conditions.push(or(...textConditions)!);
  }

  const products = await db.select().from(productsTable)
    .where(and(...conditions))
    .orderBy(desc(productsTable.updatedAt))
    .limit(limit * 2); // fetch more, then rank
  if (q.trim()) {
    products.sort((a, b) => scoreCatalogCandidate(q, {
      name: b.nameZh ?? b.name,
    }) - scoreCatalogCandidate(q, {
      name: a.nameZh ?? a.name,
    }));
  }

  // Get goal fit for each product if goal requested
  const results = await Promise.all(products.map(async (p) => {
    const [brand] = p.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, p.brandId)) : [null];
    const [barcode] = await db.select().from(barcodesTable).where(eq(barcodesTable.productId, p.id)).limit(1);
    const [evalRow] = await db.select({
      overallScore: productEvaluationsTable.overallScore,
      scoreGrade: productEvaluationsTable.scoreGrade,
      rulesetVersion: productEvaluationsTable.rulesetVersion,
    })
      .from(productEvaluationsTable).where(eq(productEvaluationsTable.productId, p.id))
      .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);
    const [category] = p.categoryId ? await db.select().from(categoriesTable).where(eq(categoriesTable.id, p.categoryId)) : [null];
    const [priceRow] = await db.select({ priceNtd: productRetailerPricesTable.priceNtd, retailerId: productRetailerPricesTable.retailerId })
      .from(productRetailerPricesTable).where(eq(productRetailerPricesTable.productId, p.id)).limit(1);
    const [retailer] = priceRow?.retailerId ? await db.select().from(retailersTable).where(eq(retailersTable.id, priceRow.retailerId)) : [null];

    const presentation = resolveCatalogProduct(p, barcode?.barcode, brand);
    if (presentation.verificationStatus !== "verified") return null;
    const canShowScore = evalRow?.rulesetVersion === RULESET_VERSION;
    const productSummary = {
      id: p.id, name: presentation.name, nameZh: presentation.nameZh,
      brandName: presentation.brandName, imageUrl: presentation.imageUrl,
      categorySlug: category?.slug ?? null, categoryName: category?.name ?? null,
      verificationStatus: presentation.verificationStatus,
      overallScore: canShowScore ? evalRow.overallScore : null,
      scoreGrade: canShowScore ? evalRow.scoreGrade : null,
      barcode: presentation.barcode,
      retailerName: retailer?.name ?? null,
      priceNtd: priceRow?.priceNtd ? parseFloat(priceRow.priceNtd) : null,
    };

    // Filter by retailer
    if (retailer_slug && retailer?.slug !== retailer_slug) return null;
    if (nlFilters.retailerSlugs && nlFilters.retailerSlugs.length > 0 && !nlFilters.retailerSlugs.includes(retailer?.slug ?? "")) return null;

    let fitLevel: string | null = null;
    const matchReasons: string[] = [];
    const matchReasonsZh: string[] = [];

    if (effectiveGoalSlug) {
      // Check cached or compute goal fit
      let cached = await db.select().from(goalProductEvaluationsTable)
        .where(and(eq(goalProductEvaluationsTable.productId, p.id)))
        .then(rows => rows.find(r => {
          return r.goalRulesetVersion === GOAL_RULESET_VERSION;
        }));

      if (!cached) {
        const [nutrition] = await db.select().from(nutritionFactsTable).where(eq(nutritionFactsTable.productId, p.id));
        const nutritionEvidence = presentation.evidence?.nutrition ?? {
          protein: numeric(nutrition?.protein),
          dietaryFiber: numeric(nutrition?.dietaryFiber),
          totalSugars: numeric(nutrition?.totalSugars),
          sodium: numeric(nutrition?.sodium),
          calories: numeric(nutrition?.calories),
        };
        const result = calculateGoalFit(effectiveGoalSlug, {
          protein: nutritionEvidence.protein ?? null,
          dietaryFiber: nutritionEvidence.dietaryFiber ?? null,
          totalSugars: nutritionEvidence.totalSugars ?? null,
          sodium: nutritionEvidence.sodium ?? null,
          calories: nutritionEvidence.calories ?? null,
        });
        fitLevel = result.fitLevel;
        matchReasonsZh.push(...result.fitReasons.filter(r => r.positive).map(r => r.labelZh).slice(0, 2));
        matchReasons.push(...result.fitReasons.filter(r => r.positive).map(r => r.label).slice(0, 2));
      } else {
        fitLevel = cached.fitLevel;
        const reasons = (cached.fitReasons as any[]) ?? [];
        matchReasonsZh.push(...reasons.filter(r => r.positive).map((r: any) => r.labelZh).slice(0, 2));
        matchReasons.push(...reasons.filter(r => r.positive).map((r: any) => r.label).slice(0, 2));
      }
    }

    if (retailer?.name) {
      matchReasonsZh.push(`${retailer.name} 可購買`);
      matchReasons.push(`Available at ${retailer.name}`);
    }

    let relevanceLabel = "相關商品";
    let relevanceLabelZh = "相關商品";
    if (fitLevel === "great_fit") { relevanceLabel = "Great fit for your goal"; relevanceLabelZh = "非常符合你的目標"; }
    else if (fitLevel === "good_fit") { relevanceLabel = "Good fit"; relevanceLabelZh = "符合你的目標"; }
    else if (fitLevel === "mixed_fit") { relevanceLabel = "Mixed fit"; relevanceLabelZh = "部分符合目標"; }
    else if (fitLevel === "poor_fit") { relevanceLabel = "Not ideal for goal"; relevanceLabelZh = "不太符合目標"; }

    return {
      product: productSummary,
      relevanceLabel,
      relevanceLabelZh,
      fitLevel,
      matchReasons,
      matchReasonsZh,
    };
  }));

  const filtered = results.filter(Boolean);

  // Sort: great_fit > good_fit > mixed_fit > poor_fit > insufficient_data > null
  const fitOrder: Record<string, number> = {
    great_fit: 0, good_fit: 1, mixed_fit: 2, poor_fit: 3, insufficient_data: 4,
  };
  filtered.sort((a, b) =>
    (fitOrder[a!.fitLevel ?? ""] ?? 5) - (fitOrder[b!.fitLevel ?? ""] ?? 5)
  );

  // Catalog seed matches (unverified retailer catalog rows — never scored)
  const catalogItems: any[] = [];
  if (searchTerms.length > 0) {
    try {
      // Parameterized: user terms are bound values, never interpolated into SQL text
      const termConds = searchTerms
        .map(t => t.slice(0, 100))
        .map(t => {
          const pat = `%${t}%`;
          return sql`(product_name ILIKE ${pat} OR brand_raw ILIKE ${pat} OR category_normalized ILIKE ${pat})`;
        });
      const catalogLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
      const rows = await db.execute(sql`
        SELECT facta_seed_id, product_name, brand_raw, retailer, category_normalized,
               spec_raw, price_twd, image_url, source_url
        FROM facta_catalog_seed
        WHERE ${sql.join(termConds, sql` OR `)}
        ORDER BY catalog_completeness_score DESC NULLS LAST, product_name
        LIMIT ${Math.min(catalogLimit * 12, 240)}`);
      const rankedRows = [...((rows as any).rows ?? rows)]
        .map((r: any) => ({
          row: r,
          matchScore: scoreCatalogCandidate(q, {
            name: r.product_name,
            brandName: r.brand_raw,
            categoryName: r.category_normalized,
          }),
        }))
        .filter((item: any) => item.matchScore >= 50)
        .sort((a: any, b: any) => b.matchScore - a.matchScore)
        .slice(0, catalogLimit);
      for (const { row: r, matchScore } of rankedRows) {
        catalogItems.push({
          factaSeedId: r.facta_seed_id,
          productName: r.product_name,
          brandRaw: r.brand_raw ?? null,
          retailer: r.retailer,
          categoryNormalized: r.category_normalized ?? null,
          specRaw: r.spec_raw ?? null,
          priceTwd: r.price_twd != null ? parseFloat(r.price_twd) : null,
          imageUrl: r.image_url ?? null,
          sourceUrl: r.source_url ?? null,
          catalogSourceType: "retailer_catalog",
          evidenceTier: "catalog_only",
          aiEnrichmentStatus: null,
          matchScore,
        });
      }
    } catch (err) {
      req.log.warn({ err }, "catalog seed search failed");
    }

    try {
      const termConds = searchTerms
        .map(t => t.slice(0, 100))
        .map(t => {
          const pat = `%${t}%`;
          return sql`(product_name ILIKE ${pat} OR brand_name ILIKE ${pat} OR category_name ILIKE ${pat})`;
        });
      const remainingLimit = Math.max(0, Math.min(Math.max(Number(limit) || 20, 1), 50) - catalogItems.length);
      if (remainingLimit > 0) {
        const rows = await db.execute(sql`
          SELECT source_key, source_record_id, product_name, brand_name,
                 category_name, package_spec, image_urls, source_url,
                 evidence_tier, ai_enrichment_status
          FROM catalog_import_candidates
          WHERE verification_status IN ('imported_unverified', 'pending_review')
            AND (${sql.join(termConds, sql` OR `)})
          ORDER BY CASE evidence_tier
            WHEN 'review_ready' THEN 0
            WHEN 'nutrition_ready' THEN 1
            WHEN 'ingredients_ready' THEN 2
            ELSE 3
          END, product_name
          LIMIT ${Math.min(Math.max(remainingLimit, 1) * 12, 240)}`);
        const rankedRows = [...((rows as any).rows ?? rows)]
          .map((r: any) => ({
            row: r,
            matchScore: scoreCatalogCandidate(q, {
              name: r.product_name,
              brandName: r.brand_name,
              categoryName: r.category_name,
            }),
          }))
          .filter((item: any) => item.matchScore >= 50)
          .sort((a: any, b: any) => b.matchScore - a.matchScore)
          .slice(0, remainingLimit);
        for (const { row: r, matchScore } of rankedRows) {
          const imageUrls = Array.isArray(r.image_urls) ? r.image_urls : [];
          catalogItems.push({
            factaSeedId: `${r.source_key}:${r.source_record_id}`,
            productName: r.product_name,
            brandRaw: r.brand_name ?? null,
            retailer: "食藥署追溯資料",
            categoryNormalized: r.category_name ?? null,
            specRaw: r.package_spec ?? null,
            priceTwd: null,
            imageUrl: imageUrls[0] ?? null,
            sourceUrl: r.source_url ?? null,
            catalogSourceType: "official_traceability",
            evidenceTier: r.evidence_tier ?? "catalog_only",
            aiEnrichmentStatus: r.ai_enrichment_status ?? null,
            matchScore,
          });
        }
      }
    } catch (err) {
      // The source-backed import migration is intentionally deployable before
      // the production data operation. Search remains available during that gap.
      req.log.warn({ err }, "source-backed catalog search unavailable");
    }
  }

  // Related guides
  const guides = effectiveGoalSlug
    ? await db.select().from(guidesTable).where(and(
        eq(guidesTable.status, "published"),
      )).limit(3).then(async rows => {
        const goalRows = await db.select().from(goalsTable).where(eq(goalsTable.slug, effectiveGoalSlug!));
        const goalId = goalRows[0]?.id;
        return rows.filter(g => !goalId || g.goalId === goalId);
      })
    : [];

  res.json({
    query: q,
    parsedFilters: { goalSlug: effectiveGoalSlug, mealType: effectiveMealType, retailerSlugs: nlFilters.retailerSlugs },
    products: filtered.slice(0, limit),
    guides: guides.map(g => ({
      id: g.id, slug: g.slug, title: g.title, titleZh: g.titleZh,
      summaryZh: g.summaryZh, summary: g.summary, goalId: g.goalId,
      coverImageUrl: g.coverImageUrl, status: g.status,
      publishedAt: g.publishedAt?.toISOString() ?? null,
    })),
    catalogItems,
    total: filtered.length,
    hasMore: filtered.length > limit,
  });
});

export default router;

function numeric(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
