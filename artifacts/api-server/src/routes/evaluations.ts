import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  productEvaluationsTable, productsTable, brandsTable,
  nutritionFactsTable, productIngredientsTable, ingredientsTable,
  productAllergensTable, allergensTable,
} from "@workspace/db";
import { GetProductEvaluationParams, GetShareCardParams } from "@workspace/api-zod";
import { calculateScore, RULESET_VERSION } from "../lib/scoring.js";

const router: IRouter = Router();

async function getOrComputeEvaluation(productId: number) {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) return null;

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

  const ingredients = ingredientRows.length > 0
    ? ingredientRows.map(r => ({
        name: r.pi.rawName,
        riskLevel: r.ing?.riskLevel ?? null,
        isAdditive: r.ing?.isAdditive ?? null,
        evidenceStrength: r.ing?.evidenceStrength ?? null,
        riskReason: r.ing?.riskReason ?? null,
      }))
    : await mapRawIngredients(product.ingredientsList);

  const dataCompleteness = calculateCompleteness(product, nutrition ?? null, ingredients);

  const result = calculateScore({
    nutrition: nutrition ? {
      servingSize: nutrition.servingSize ? parseFloat(nutrition.servingSize) : null,
      servingSizeUnit: nutrition.servingSizeUnit,
      calories: nutrition.calories ? parseFloat(nutrition.calories) : null,
      totalFat: nutrition.totalFat ? parseFloat(nutrition.totalFat) : null,
      saturatedFat: nutrition.saturatedFat ? parseFloat(nutrition.saturatedFat) : null,
      transFat: nutrition.transFat ? parseFloat(nutrition.transFat) : null,
      sodium: nutrition.sodium ? parseFloat(nutrition.sodium) : null,
      totalCarbs: nutrition.totalCarbs ? parseFloat(nutrition.totalCarbs) : null,
      dietaryFiber: nutrition.dietaryFiber ? parseFloat(nutrition.dietaryFiber) : null,
      totalSugars: nutrition.totalSugars ? parseFloat(nutrition.totalSugars) : null,
      protein: nutrition.protein ? parseFloat(nutrition.protein) : null,
    } : null,
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
    verificationStatus: product.verificationStatus,
    dataCompleteness: String(dataCompleteness),
    evidenceConfidence: result.evidenceConfidence,
    topReasons: result.topReasons,
    additiveFlags: result.additiveFlags,
    allergenAlerts: [],
  }).returning();

  return saved;
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

  const evaluation = await getOrComputeEvaluation(params.data.productId);
  if (!evaluation) { res.status(404).json({ error: "Product not found" }); return; }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.productId));
  const [brand] = product?.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, product.brandId)) : [null];

  const allergenRows = await db
    .select({ pa: productAllergensTable, al: allergensTable })
    .from(productAllergensTable)
    .leftJoin(allergensTable, eq(productAllergensTable.allergenId, allergensTable.id))
    .where(eq(productAllergensTable.productId, params.data.productId));

  res.json({
    id: evaluation.id,
    productId: evaluation.productId,
    productName: product?.name ?? null,
    productNameZh: product?.nameZh ?? null,
    brandName: brand?.name ?? null,
    imageUrl: product?.imageUrl ?? null,
    overallScore: evaluation.overallScore,
    nutritionScore: evaluation.nutritionScore,
    additiveScore: evaluation.additiveScore,
    analysisScope:
      evaluation.nutritionScore != null && evaluation.additiveScore != null ? "complete" :
      evaluation.nutritionScore != null ? "nutrition_only" :
      evaluation.additiveScore != null ? "ingredients_only" : "insufficient",
    scoreGrade: evaluation.scoreGrade,
    verdict: evaluation.verdict,
    verdictZh: evaluation.verdictZh,
    verificationStatus: evaluation.verificationStatus,
    dataCompleteness: evaluation.dataCompleteness ? parseFloat(evaluation.dataCompleteness) : null,
    evidenceConfidence: evaluation.evidenceConfidence,
    rulesetVersion: evaluation.rulesetVersion,
    evaluatedAt: evaluation.evaluatedAt.toISOString(),
    topReasons: (evaluation.topReasons as any[]) ?? [],
    additiveFlags: (evaluation.additiveFlags as any[]) ?? [],
    allergenAlerts: allergenRows.map(r => ({
      name: r.al?.name ?? "Unknown",
      nameZh: r.al?.nameZh ?? null,
      severity: r.al?.severity ?? "moderate",
      source: r.pa.sourceType,
    })),
    personalAlerts: [],
  });
});

router.get("/share-cards/:productId", async (req, res): Promise<void> => {
  const params = GetShareCardParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const evaluation = await getOrComputeEvaluation(params.data.productId);
  if (!evaluation) { res.status(404).json({ error: "Product not found" }); return; }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.productId));
  const [brand] = product?.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, product.brandId)) : [null];

  const { alternativeProductLinksTable, productsTable: pt } = await import("@workspace/db");
  const [altLink] = await db.select()
    .from(alternativeProductLinksTable)
    .where(eq(alternativeProductLinksTable.productId, params.data.productId))
    .limit(1);
  const [altProduct] = altLink ? await db.select().from(pt).where(eq(pt.id, altLink.alternativeProductId)) : [null];

  const topReasons = ((evaluation.topReasons as any[]) ?? []).slice(0, 3);

  res.json({
    productName: product?.name ?? "Unknown",
    productNameZh: product?.nameZh ?? null,
    brandName: brand?.name ?? null,
    imageUrl: product?.imageUrl ?? null,
    overallScore: evaluation.overallScore,
    analysisScope:
      evaluation.nutritionScore != null && evaluation.additiveScore != null ? "complete" :
      evaluation.nutritionScore != null ? "nutrition_only" :
      evaluation.additiveScore != null ? "ingredients_only" : "insufficient",
    scoreGrade: evaluation.scoreGrade,
    verdict: evaluation.verdict,
    verdictZh: evaluation.verdictZh,
    topReasons,
    evidenceConfidence: evaluation.evidenceConfidence,
    alternativeName: altProduct?.name ?? null,
    alternativeNameZh: altProduct?.nameZh ?? null,
    rulesetVersion: evaluation.rulesetVersion,
    evaluatedAt: evaluation.evaluatedAt.toISOString(),
  });
});

export default router;
