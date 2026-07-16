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
  // Try cached evaluation
  const [cached] = await db.select().from(productEvaluationsTable)
    .where(eq(productEvaluationsTable.productId, productId))
    .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);

  if (cached && cached.rulesetVersion === RULESET_VERSION) return cached;

  // Compute fresh
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) return null;

  const [nutrition] = await db.select().from(nutritionFactsTable).where(eq(nutritionFactsTable.productId, productId));
  const ingredientRows = await db
    .select({ pi: productIngredientsTable, ing: ingredientsTable })
    .from(productIngredientsTable)
    .leftJoin(ingredientsTable, eq(productIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(productIngredientsTable.productId, productId));

  const dataCompleteness = calculateCompleteness(product, nutrition ?? null, ingredientRows.length);

  const result = calculateScore({
    nutrition: nutrition ? {
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
    ingredients: ingredientRows.map(r => ({
      name: r.pi.rawName,
      riskLevel: r.ing?.riskLevel ?? null,
      isAdditive: r.ing?.isAdditive ?? null,
      evidenceStrength: r.ing?.evidenceStrength ?? null,
      riskReason: r.ing?.riskReason ?? null,
    })),
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

function calculateCompleteness(product: any, nutrition: any, ingredientCount: number): number {
  let score = 0;
  let max = 0;
  max += 2; if (product.ingredientsList) score += 2;
  max += 3; if (nutrition) score += 3;
  max += 2; if (ingredientCount > 0) score += 2;
  max += 1; if (product.imageUrl) score += 1;
  max += 1; if (product.brandId) score += 1;
  return Math.round((score / max) * 100) / 100;
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
