import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  productEvaluationsTable, productsTable, brandsTable,
  nutritionFactsTable, productIngredientsTable, ingredientsTable,
  productAllergensTable, allergensTable, barcodesTable,
  userPreferencesTable,
} from "@workspace/db";
import { GetProductEvaluationParams, GetProductEvaluationQueryParams, GetShareCardParams } from "@workspace/api-zod";
import { calculateScore, recommendProductAction, resolveAnalysisScope, RULESET_VERSION } from "../lib/scoring.js";
import { resolveCatalogProduct } from "../lib/catalogEvidence.js";
import { buildPersonalization } from "../lib/personalization.js";

const router: IRouter = Router();

async function getOrComputeEvaluation(productId: number) {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) return null;
  const catalogProduct = resolveCatalogProduct(product, null, null);

  // Reuse a cache only when both the rules and source product are unchanged.
  const [cached] = await db.select().from(productEvaluationsTable)
    .where(eq(productEvaluationsTable.productId, productId))
    .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);

  if (
    cached &&
    cached.rulesetVersion === RULESET_VERSION &&
    cached.evaluatedAt.getTime() >= product.updatedAt.getTime()
  ) return cached;

  const [nutrition] = await db.select().from(nutritionFactsTable).where(eq(nutritionFactsTable.productId, productId));
  const ingredientRows = await db
    .select({ pi: productIngredientsTable, ing: ingredientsTable })
    .from(productIngredientsTable)
    .leftJoin(ingredientsTable, eq(productIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(productIngredientsTable.productId, productId));

  const canUseDatabaseEvidence = catalogProduct.verificationStatus !== "catalog_unverified";
  const trustedIngredientList = catalogProduct.evidence?.ingredientsList ?? null;
  const ingredients = trustedIngredientList
    ? await mapRawIngredients(trustedIngredientList)
    : canUseDatabaseEvidence && ingredientRows.length > 0
    ? ingredientRows.map(r => ({
        name: r.pi.rawName,
        riskLevel: r.ing?.riskLevel ?? null,
        isAdditive: r.ing?.isAdditive ?? null,
        evidenceStrength: r.ing?.evidenceStrength ?? null,
        riskReason: r.ing?.riskReason ?? null,
      }))
    : canUseDatabaseEvidence
      ? await mapRawIngredients(product.ingredientsList)
      : [];

  const resolvedNutrition = catalogProduct.evidence
    ? catalogProduct.evidence.nutrition
    : canUseDatabaseEvidence && nutrition ? {
    servingSize: parseNullableNumber(nutrition.servingSize),
    servingSizeUnit: nutrition.servingSizeUnit,
    calories: parseNullableNumber(nutrition.calories),
    totalFat: parseNullableNumber(nutrition.totalFat),
    saturatedFat: parseNullableNumber(nutrition.saturatedFat),
    transFat: parseNullableNumber(nutrition.transFat),
    sodium: parseNullableNumber(nutrition.sodium),
    totalCarbs: parseNullableNumber(nutrition.totalCarbs),
    dietaryFiber: parseNullableNumber(nutrition.dietaryFiber),
    totalSugars: parseNullableNumber(nutrition.totalSugars),
    protein: parseNullableNumber(nutrition.protein),
    } : null;

  const evidenceProduct = {
    ...product,
    ingredientsList: catalogProduct.ingredientsList,
    imageUrl: catalogProduct.imageUrl,
  };
  const dataCompleteness = calculateCompleteness(evidenceProduct, resolvedNutrition, ingredients);

  const result = calculateScore({
    productName: catalogProduct.nameZh ?? catalogProduct.name,
    nutrition: resolvedNutrition,
    ingredients,
    dataCompleteness,
  });

  // Save evaluation
  const [saved] = await db.insert(productEvaluationsTable).values({
    productId,
    rulesetVersion: result.rulesetVersion,
    overallScore: result.overallScore,
    nutritionScore: result.nutritionScore,
    additiveScore: result.additiveScore,
    scoreGrade: result.scoreGrade,
    verdict: result.verdict,
    verdictZh: result.verdictZh,
    verificationStatus: catalogProduct.verificationStatus,
    dataCompleteness: String(dataCompleteness),
    evidenceConfidence: result.evidenceConfidence,
    topReasons: result.topReasons,
    additiveFlags: result.additiveFlags,
    allergenAlerts: [],
  }).returning();

  return saved;
}

function parseNullableNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIngredientName(value: string): string {
  return value.toLowerCase().replace(/[\s()（）\[\]【】.。:：]/g, "");
}

function splitRawIngredients(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[、,，;；\n]/)
    .map(value => value.trim())
    .filter(value => value.length > 0)
    .slice(0, 100);
}

async function mapRawIngredients(raw: string | null) {
  const tokens = splitRawIngredients(raw);
  if (tokens.length === 0) return [];

  const references = await db.select().from(ingredientsTable);
  const byName = new Map<string, typeof ingredientsTable.$inferSelect>();
  for (const reference of references) {
    byName.set(normalizeIngredientName(reference.name), reference);
    if (reference.nameZh) byName.set(normalizeIngredientName(reference.nameZh), reference);
  }

  return tokens.map(name => {
    const reference = byName.get(normalizeIngredientName(name));
    return {
      name,
      riskLevel: reference?.riskLevel ?? "unknown",
      isAdditive: reference?.isAdditive ?? null,
      evidenceStrength: reference?.evidenceStrength ?? null,
      riskReason: reference?.riskReason ?? null,
    };
  });
}

function calculateCompleteness(product: any, nutrition: any, ingredients: Array<{ riskLevel?: string | null }>): number {
  let score = 0;
  if (product.ingredientsList) score += 2;
  if (nutrition?.totalSugars != null) score += 1;
  if (nutrition?.sodium != null) score += 1;
  if (nutrition?.saturatedFat != null) score += 1;
  if (nutrition?.servingSize && nutrition?.servingSizeUnit) score += 1;
  if (ingredients.length > 0) {
    const reviewed = ingredients.filter(item => ["safe", "caution", "avoid"].includes(item.riskLevel ?? "")).length;
    score += 2 * (reviewed / ingredients.length);
  }
  if (product.imageUrl) score += 1;
  if (product.brandId) score += 1;
  return Math.round((score / 10) * 100) / 100;
}

router.get("/evaluations/product/:productId", async (req, res): Promise<void> => {
  const params = GetProductEvaluationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const query = GetProductEvaluationQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const evaluation = await getOrComputeEvaluation(params.data.productId);
  if (!evaluation) { res.status(404).json({ error: "Product not found" }); return; }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.productId));
  const [brand] = product?.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, product.brandId)) : [null];
  const [barcode] = product ? await db.select().from(barcodesTable).where(eq(barcodesTable.productId, product.id)).limit(1) : [null];
  const catalogProduct = product ? resolveCatalogProduct(product, barcode?.barcode, brand) : null;
  const responseIngredients = splitRawIngredients(catalogProduct?.ingredientsList ?? product?.ingredientsList ?? null).map(name => ({ name }));

  const allergenRows = await db
    .select({ pa: productAllergensTable, al: allergensTable })
    .from(productAllergensTable)
    .leftJoin(allergensTable, eq(productAllergensTable.allergenId, allergensTable.id))
    .where(eq(productAllergensTable.productId, params.data.productId));

  const allergenAlerts = catalogProduct?.evidence?.allergens
    ?? (catalogProduct?.verificationStatus === "catalog_unverified" ? [] : allergenRows.map(r => ({
      name: r.al?.name ?? "Unknown",
      nameZh: r.al?.nameZh ?? null,
      severity: r.al?.severity ?? "moderate",
      source: r.pa.sourceType,
    })));
  const [preferences] = query.data.session_id
    ? await db.select().from(userPreferencesTable).where(eq(userPreferencesTable.sessionId, query.data.session_id)).limit(1)
    : [undefined];
  const topReasons = (evaluation.topReasons as any[]) ?? [];
  const additiveFlags = (evaluation.additiveFlags as any[]) ?? [];
  const personal = buildPersonalization(preferences, {
    allergens: allergenAlerts,
    ingredientNames: responseIngredients.map(item => item.name),
    negativeReasons: topReasons.filter(reason => reason.impact === "negative"),
    additiveFlags,
  });
  const analysisScope = resolveAnalysisScope(
    { nutritionScore: evaluation.nutritionScore, additiveScore: evaluation.additiveScore },
    { productName: catalogProduct?.nameZh ?? catalogProduct?.name ?? product?.nameZh ?? product?.name, ingredients: responseIngredients },
  );
  const baseActionRecommendation = recommendProductAction({
    analysisScope,
    overallScore: evaluation.overallScore,
    evidenceConfidence: evaluation.evidenceConfidence,
    topReasons,
    additiveFlags,
  });
  const firstPersonalAlert = personal.personalAlerts[0];
  const actionRecommendation = firstPersonalAlert
    ? {
        code: "swap" as const,
        label: "Swap it for this person",
        labelZh: "換一款",
        reason: `This product conflicts with a saved household food profile: ${firstPersonalAlert.message}`,
        reasonZh: `這款與已儲存的家庭飲食條件衝突：${firstPersonalAlert.messageZh}`,
        isPersonalized: true,
      }
    : baseActionRecommendation;

  res.json({
    id: evaluation.id,
    productId: evaluation.productId,
    productName: catalogProduct?.name ?? null,
    productNameZh: catalogProduct?.nameZh ?? null,
    brandName: catalogProduct?.brandName ?? null,
    imageUrl: catalogProduct?.imageUrl ?? null,
    overallScore: evaluation.overallScore,
    nutritionScore: evaluation.nutritionScore,
    additiveScore: evaluation.additiveScore,
    analysisScope,
    scoreGrade: evaluation.scoreGrade,
    verdict: evaluation.verdict,
    verdictZh: evaluation.verdictZh,
    verificationStatus: catalogProduct?.verificationStatus ?? evaluation.verificationStatus,
    dataCompleteness: evaluation.dataCompleteness ? parseFloat(evaluation.dataCompleteness) : null,
    evidenceConfidence: evaluation.evidenceConfidence,
    rulesetVersion: evaluation.rulesetVersion,
    evaluatedAt: evaluation.evaluatedAt.toISOString(),
    topReasons,
    additiveFlags,
    allergenAlerts,
    personalAlerts: personal.personalAlerts,
    personalization: personal.personalization,
    actionRecommendation,
  });
});

router.get("/share-cards/:productId", async (req, res): Promise<void> => {
  const params = GetShareCardParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const evaluation = await getOrComputeEvaluation(params.data.productId);
  if (!evaluation) { res.status(404).json({ error: "Product not found" }); return; }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.productId));
  const [brand] = product?.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, product.brandId)) : [null];
  const [barcode] = product ? await db.select().from(barcodesTable).where(eq(barcodesTable.productId, product.id)).limit(1) : [null];
  const catalogProduct = product ? resolveCatalogProduct(product, barcode?.barcode, brand) : null;
  const responseIngredients = splitRawIngredients(catalogProduct?.ingredientsList ?? product?.ingredientsList ?? null).map(name => ({ name }));

  const { alternativeProductLinksTable, productsTable: pt } = await import("@workspace/db");
  const [altLink] = await db.select()
    .from(alternativeProductLinksTable)
    .where(eq(alternativeProductLinksTable.productId, params.data.productId))
    .limit(1);
  const [altProduct] = altLink ? await db.select().from(pt).where(eq(pt.id, altLink.alternativeProductId)) : [null];
  const altCatalogProduct = altProduct ? resolveCatalogProduct(altProduct, null, null) : null;

  const topReasons = ((evaluation.topReasons as any[]) ?? []).slice(0, 3);
  const analysisScope = resolveAnalysisScope(
    { nutritionScore: evaluation.nutritionScore, additiveScore: evaluation.additiveScore },
    { productName: catalogProduct?.nameZh ?? catalogProduct?.name ?? product?.nameZh ?? product?.name, ingredients: responseIngredients },
  );
  const actionRecommendation = recommendProductAction({
    analysisScope,
    overallScore: evaluation.overallScore,
    evidenceConfidence: evaluation.evidenceConfidence,
    topReasons,
    additiveFlags: (evaluation.additiveFlags as any[]) ?? [],
  });

  res.json({
    productName: catalogProduct?.name ?? "Unknown",
    productNameZh: catalogProduct?.nameZh ?? null,
    brandName: catalogProduct?.brandName ?? null,
    imageUrl: catalogProduct?.imageUrl ?? null,
    overallScore: evaluation.overallScore,
    analysisScope,
    scoreGrade: evaluation.scoreGrade,
    verdict: evaluation.verdict,
    verdictZh: evaluation.verdictZh,
    topReasons,
    evidenceConfidence: evaluation.evidenceConfidence,
    actionRecommendation,
    alternativeName: altCatalogProduct?.name ?? null,
    alternativeNameZh: altCatalogProduct?.nameZh ?? null,
    rulesetVersion: evaluation.rulesetVersion,
    evaluatedAt: evaluation.evaluatedAt.toISOString(),
  });
});

export default router;
