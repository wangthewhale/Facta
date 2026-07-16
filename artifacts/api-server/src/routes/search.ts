import { Router, type IRouter } from "express";
import { ilike, or, eq, and, desc } from "drizzle-orm";
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

const router: IRouter = Router();

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
  const searchTerms = [q, ...nlFilters.keywords].filter(Boolean);
  const conditions = [eq(productsTable.verificationStatus, "verified")];

  if (searchTerms.length > 0) {
    const textConditions = searchTerms.map(term =>
      or(
        ilike(productsTable.name, `%${term}%`),
        ilike(productsTable.nameZh, `%${term}%`),
        ilike(productsTable.ingredientsList, `%${term}%`),
      )
    );
    conditions.push(or(...textConditions)!);
  }

  const products = await db.select().from(productsTable)
    .where(and(...conditions))
    .orderBy(desc(productsTable.updatedAt))
    .limit(limit * 2); // fetch more, then rank

  // Get goal fit for each product if goal requested
  const results = await Promise.all(products.map(async (p) => {
    const [brand] = p.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, p.brandId)) : [null];
    const [barcode] = await db.select().from(barcodesTable).where(eq(barcodesTable.productId, p.id)).limit(1);
    const [evalRow] = await db.select({ overallScore: productEvaluationsTable.overallScore, scoreGrade: productEvaluationsTable.scoreGrade })
      .from(productEvaluationsTable).where(eq(productEvaluationsTable.productId, p.id))
      .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);
    const [category] = p.categoryId ? await db.select().from(categoriesTable).where(eq(categoriesTable.id, p.categoryId)) : [null];
    const [priceRow] = await db.select({ priceNtd: productRetailerPricesTable.priceNtd, retailerId: productRetailerPricesTable.retailerId })
      .from(productRetailerPricesTable).where(eq(productRetailerPricesTable.productId, p.id)).limit(1);
    const [retailer] = priceRow?.retailerId ? await db.select().from(retailersTable).where(eq(retailersTable.id, priceRow.retailerId)) : [null];

    const productSummary = {
      id: p.id, name: p.name, nameZh: p.nameZh,
      brandName: brand?.name ?? null, imageUrl: p.imageUrl,
      categorySlug: category?.slug ?? null, categoryName: category?.name ?? null,
      verificationStatus: p.verificationStatus,
      overallScore: evalRow?.overallScore ?? null, scoreGrade: evalRow?.scoreGrade ?? null,
      barcode: barcode?.barcode ?? null,
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
        const result = calculateGoalFit(effectiveGoalSlug, {
          protein: nutrition?.protein ? parseFloat(nutrition.protein) : null,
          dietaryFiber: nutrition?.dietaryFiber ? parseFloat(nutrition.dietaryFiber) : null,
          totalSugars: nutrition?.totalSugars ? parseFloat(nutrition.totalSugars) : null,
          sodium: nutrition?.sodium ? parseFloat(nutrition.sodium) : null,
          calories: nutrition?.calories ? parseFloat(nutrition.calories) : null,
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
    total: filtered.length,
    hasMore: filtered.length > limit,
  });
});

export default router;
