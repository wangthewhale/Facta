import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  productSubmissionsTable, productsTable, brandsTable, barcodesTable,
  nutritionFactsTable, productEvaluationsTable, ingredientsTable,
  retailersTable, productRetailerPricesTable,
} from "@workspace/db";
import {
  GetSubmissionParams, ConfirmOcrParams, ConfirmOcrBody,
  CreateSubmissionBody, ProcessOcrBody, FinalizeSubmissionParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { calculateScore, resolveAnalysisScope } from "../lib/scoring.js";
import { mapIngredientList } from "../lib/ingredientEvidence.js";
import {
  getConvenienceRetailerBySlug,
  resolveConvenienceRetailer,
} from "../lib/convenienceRetailer.js";

const router: IRouter = Router();

const MAX_OCR_IMAGE_BYTES = 8 * 1024 * 1024;
const OCR_RATE_LIMIT = 8;
const OCR_RATE_WINDOW_MS = 10 * 60 * 1000;
const ocrRateBuckets = new Map<string, { count: number; resetAt: number }>();

type ExtractedNutrition = {
  [key: string]: number | string | null | undefined;
  servingSize?: number | null;
  servingSizeUnit?: string | null;
  calories?: number | null;
  totalFat?: number | null;
  saturatedFat?: number | null;
  transFat?: number | null;
  sodium?: number | null;
  totalCarbs?: number | null;
  dietaryFiber?: number | null;
  totalSugars?: number | null;
  protein?: number | null;
  netWeight?: number | null;
  netWeightUnit?: string | null;
  caloriesBasis?: "per_serving" | "per_package" | null;
};

function canProcessOcr(clientId: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const current = ocrRateBuckets.get(clientId);
  if (!current || current.resetAt <= now) {
    ocrRateBuckets.set(clientId, { count: 1, resetAt: now + OCR_RATE_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= OCR_RATE_LIMIT) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function splitSubmissionIngredients(raw: string) {
  return mapIngredientList(raw);
}

function submissionToApi(s: typeof productSubmissionsTable.$inferSelect) {
  return {
    id: s.id,
    productName: s.productName,
    brandName: s.brandName,
    barcode: s.barcode,
    retailerSlug: s.retailerSlug,
    status: s.status,
    ocrStatus: s.ocrStatus,
    extractedIngredients: s.extractedIngredients,
    provisionalScore: s.provisionalScore,
    provisionalGrade: s.provisionalGrade,
    dataCompleteness: s.dataCompleteness ? parseFloat(s.dataCompleteness) : null,
    userSession: s.userSession,
    reviewNote: s.reviewNote,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

router.post("/submissions/ocr", async (req, res): Promise<void> => {
  const parsed = ProcessOcrBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { imageBase64, imageType = "ingredients", imageMimeType = "image/jpeg" } = parsed.data;
  const estimatedBytes = Math.floor(imageBase64.replace(/\s/g, "").length * 0.75);
  if (estimatedBytes > MAX_OCR_IMAGE_BYTES) {
    res.status(413).json({ error: "Image is larger than the 8 MB limit" });
    return;
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(imageBase64)) {
    res.status(400).json({ error: "Invalid base64 image data" });
    return;
  }

  const rate = canProcessOcr(req.ip || "unknown");
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSeconds));
    res.status(429).json({ error: "Too many image analyses. Please try again later." });
    return;
  }

  try {
    const systemPrompt = `You are an OCR assistant for FACTA, a food product intelligence app in Taiwan.
Extract text from food product label images. Return a JSON object with:
- extractedText: the full raw text extracted
- productName: the full detailed product name exactly as printed on the label (e.g. "愛之味雙纖麥仔茶 590ml"), or null if not visible
- brandName: the brand/manufacturer name as printed (e.g. "愛之味"), or null if not visible
- retailerName: the convenience-store chain visibly printed on the package or shelf label
  (7-ELEVEN, FamilyMart/全家, Hi-Life/萊爾富, or OKmart/OK超商), or null if it is not visible
- rawIngredients: the ingredients list if visible (as a single string)
- parsedNutrition: an object with numeric nutrition values if a nutrition facts panel is visible
  (servingSize, servingSizeUnit, calories, totalFat, saturatedFat, transFat, sodium, totalCarbs, dietaryFiber, totalSugars, protein — values exactly as shown per labelled serving)
  - also extract netWeight, netWeightUnit and caloriesBasis when a fresh-food sticker prints package weight and "熱量每份" or "每包熱量"
  - servingSize must use the printed metric quantity and servingSizeUnit must be exactly "g" or "ml"
  - when both imperial and metric are printed, prefer the printed metric equivalent (for example, 20 FL OZ (590mL) becomes servingSize 590 and servingSizeUnit "ml")
  - if one sealed fresh-food package prints both a net weight and "熱量每份" without a separate serving count, keep netWeight separately; do not silently treat package weight as a full nutrition panel
  - do not calculate a metric conversion when the package does not print one
- confidence: a number 0-1 representing extraction confidence

If the image is ${imageType === "ingredients" ? "an ingredients list" : imageType === "nutrition" ? "a nutrition facts panel" : "a product front"}.
Do not invent data. If something is not visible, set it to null. Return only the JSON object.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user", content: [
            { type: "text", text: `Extract text from this food product ${imageType} image.` },
            { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
          ]
        }
      ],
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    let parsed2: any = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed2 = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      parsed2 = { extractedText: content, confidence: 0.3 };
    }

    const retailerIdentity = resolveConvenienceRetailer({
      barcode: null,
      brandNames: [parsed2.brandName],
      productNames: [parsed2.productName],
      packageText: [parsed2.retailerName, parsed2.extractedText],
    });

    res.json({
      extractedText: parsed2.extractedText ?? content,
      confidence: parsed2.confidence ?? 0.5,
      structuredData: parsed2,
      rawIngredients: parsed2.rawIngredients ?? null,
      parsedNutrition: parsed2.parsedNutrition ?? null,
      productName: typeof parsed2.productName === "string" && parsed2.productName.trim() ? parsed2.productName.trim() : null,
      brandName: typeof parsed2.brandName === "string" && parsed2.brandName.trim() ? parsed2.brandName.trim() : null,
      retailerName: retailerIdentity.retailerName,
      retailerSlug: retailerIdentity.retailerSlug,
      retailerConfidence: retailerIdentity.retailerConfidence,
      retailerReasonZh: retailerIdentity.retailerReasonZh,
    });
  } catch (err) {
    req.log.warn({ err }, "OCR AI unavailable");
    res.status(503).json({ error: "Image recognition is temporarily unavailable. Please retry or enter the label manually." });
  }
});

router.post("/submissions", async (req, res): Promise<void> => {
  const parsed = CreateSubmissionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [submission] = await db.insert(productSubmissionsTable).values({
    productName: parsed.data.productName,
    brandName: parsed.data.brandName ?? null,
    barcode: parsed.data.barcode ?? null,
    retailerSlug: parsed.data.retailerSlug ?? null,
    status: "pending_review",
    ocrStatus: parsed.data.rawIngredientsText ? "complete" : "pending",
    extractedIngredients: parsed.data.rawIngredientsText ?? null,
    userSession: parsed.data.userSession ?? null,
    userConsented: parsed.data.userConsented ? "true" : "false",
    dataCompleteness: "0.3",
  }).returning();

  res.status(201).json(submissionToApi(submission));
});

router.get("/submissions/:id", async (req, res): Promise<void> => {
  const params = GetSubmissionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [submission] = await db.select().from(productSubmissionsTable).where(eq(productSubmissionsTable.id, params.data.id));
  if (!submission) { res.status(404).json({ error: "Submission not found" }); return; }

  res.json(submissionToApi(submission));
});

router.patch("/submissions/:id/confirm-ocr", async (req, res): Promise<void> => {
  const params = ConfirmOcrParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = ConfirmOcrBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const nameUpdates: Record<string, string> = {};
  if (body.data.confirmedProductName?.trim()) nameUpdates.productName = body.data.confirmedProductName.trim();
  if (body.data.confirmedBrandName?.trim()) nameUpdates.brandName = body.data.confirmedBrandName.trim();

  const [updated] = await db.update(productSubmissionsTable).set({
    extractedIngredients: body.data.confirmedIngredients,
    extractedNutrition: body.data.confirmedNutrition ?? null,
    ...nameUpdates,
    ocrStatus: "confirmed",
    status: "pending_review",
    updatedAt: new Date(),
  }).where(eq(productSubmissionsTable.id, params.data.id)).returning();

  if (!updated) { res.status(404).json({ error: "Submission not found" }); return; }

  res.json(submissionToApi(updated));
});

/**
 * Instantly create a provisional product from a confirmed submission.
 * The product is scored immediately so the user gets a FACTA Report right away;
 * admin review can later upgrade it to "verified".
 */
router.post("/submissions/:id/finalize", async (req, res): Promise<void> => {
  const params = FinalizeSubmissionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  try {
    const outcome = await db.transaction(async (tx) => {
      // Lock the submission row so concurrent finalize calls serialize
      const [submission] = await tx.select().from(productSubmissionsTable)
        .where(eq(productSubmissionsTable.id, params.data.id))
        .for("update");
      if (!submission) return { status: 404 as const, error: "Submission not found" };

      // Idempotent: reuse already-created product
      if (submission.resolvedProductId) {
        const [evalRow] = await tx.select().from(productEvaluationsTable)
          .where(eq(productEvaluationsTable.productId, submission.resolvedProductId)).limit(1);
        return {
          status: 200 as const,
          body: {
            productId: submission.resolvedProductId,
            overallScore: evalRow?.overallScore,
            scoreGrade: evalRow?.scoreGrade,
            analysisScope: resolveAnalysisScope(
              { nutritionScore: evalRow?.nutritionScore, additiveScore: evalRow?.additiveScore },
              { productName: submission.productName, ingredients: splitSubmissionIngredients(submission.extractedIngredients ?? "") },
            ),
          },
        };
      }

      // Precondition: only finalize submissions with confirmed OCR data
      if (submission.ocrStatus !== "confirmed" || !submission.extractedIngredients) {
        return { status: 409 as const, error: "Submission has no confirmed OCR data to finalize" };
      }

      const hasCJK = (s: string) => /[\u4e00-\u9fff]/.test(s);

      // Brand: atomic upsert by slug
      let brandId: number | null = null;
      if (submission.brandName) {
        const slug = submission.brandName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").slice(0, 60) || "unknown";
        const [brand] = await tx.insert(brandsTable)
          .values({
            name: submission.brandName,
            nameZh: hasCJK(submission.brandName) ? submission.brandName : null,
            slug,
          })
          .onConflictDoUpdate({ target: brandsTable.slug, set: { updatedAt: new Date() } })
          .returning();
        brandId = brand.id;
      }

      const nutrition = (submission.extractedNutrition ?? null) as ExtractedNutrition | null;
      const ingredientReferences = await tx.select().from(ingredientsTable);
      const mappedIngredients = mapIngredientList(submission.extractedIngredients, ingredientReferences);
      const reviewedIngredientCoverage = mappedIngredients.length > 0
        ? mappedIngredients.filter(item => ["safe", "caution", "avoid"].includes(item.riskLevel)).length / mappedIngredients.length
        : 0;
      const hasNutrition = !!nutrition && Object.entries(nutrition)
        .some(([key, value]) => !["servingSizeUnit", "netWeight", "netWeightUnit"].includes(key) && typeof value === "number" && Number.isFinite(value));
      const hasNutritionBasis = !!nutrition && typeof nutrition.servingSize === "number" &&
        nutrition.servingSize > 0 && typeof nutrition.servingSizeUnit === "string" &&
        nutrition.servingSizeUnit.trim().length > 0;
      const dataCompleteness = hasNutritionBasis ? 0.7 : hasNutrition || reviewedIngredientCoverage >= 0.8 ? 0.5 : 0.3;
      const netWeight = nutrition && typeof nutrition.netWeight === "number" && nutrition.netWeight > 0
        ? `${nutrition.netWeight}${nutrition.netWeightUnit === "ml" ? "ml" : "g"}`
        : null;

      // Create provisional product
      const [product] = await tx.insert(productsTable).values({
        name: submission.productName,
        nameZh: hasCJK(submission.productName) ? submission.productName : null,
        brandId,
        verificationStatus: "provisional",
        dataCompleteness: String(dataCompleteness),
        ingredientsList: submission.extractedIngredients,
        netWeight,
      }).returning();

      // A user-confirmed package retailer is stored as an availability link.
      // It deliberately carries no price because the package photo proves the
      // channel identity, not a current shelf price.
      const retailerDefinition = getConvenienceRetailerBySlug(submission.retailerSlug);
      if (retailerDefinition) {
        const [retailer] = await tx.insert(retailersTable)
          .values({
            name: retailerDefinition.name,
            slug: retailerDefinition.slug,
            country: "TW",
          })
          .onConflictDoUpdate({
            target: retailersTable.slug,
            set: { name: retailerDefinition.name },
          })
          .returning();
        await tx.insert(productRetailerPricesTable).values({
          productId: product.id,
          retailerId: retailer.id,
          priceNtd: null,
          isAvailable: "true",
          sourceUrl: null,
          retrievedAt: new Date(),
        });
      }

      // Attach barcode
      if (submission.barcode) {
        await tx.insert(barcodesTable)
          .values({ barcode: submission.barcode, productId: product.id })
          .onConflictDoNothing();
      }

      // Store nutrition facts
      if (hasNutrition && nutrition) {
        const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? String(v) : null);
        await tx.insert(nutritionFactsTable).values({
          productId: product.id,
          servingSize: num(nutrition.servingSize),
          servingSizeUnit: typeof nutrition.servingSizeUnit === "string" ? nutrition.servingSizeUnit.trim().slice(0, 20) : null,
          calories: num(nutrition.calories),
          totalFat: num(nutrition.totalFat),
          saturatedFat: num(nutrition.saturatedFat),
          transFat: num(nutrition.transFat),
          sodium: num(nutrition.sodium),
          totalCarbs: num(nutrition.totalCarbs),
          dietaryFiber: num(nutrition.dietaryFiber),
          totalSugars: num(nutrition.totalSugars),
          protein: num(nutrition.protein),
          sourceType: "ocr",
        });
      }

      // Score immediately (deterministic, no I/O)
      const result = calculateScore({
        productName: submission.productName,
        nutrition: hasNutrition && nutrition ? {
          servingSize: nutrition.servingSize ?? null,
          servingSizeUnit: typeof nutrition.servingSizeUnit === "string" ? nutrition.servingSizeUnit : null,
          calories: nutrition.calories ?? null,
          totalFat: nutrition.totalFat ?? null,
          saturatedFat: nutrition.saturatedFat ?? null,
          transFat: nutrition.transFat ?? null,
          sodium: nutrition.sodium ?? null,
          totalCarbs: nutrition.totalCarbs ?? null,
          dietaryFiber: nutrition.dietaryFiber ?? null,
          totalSugars: nutrition.totalSugars ?? null,
          protein: nutrition.protein ?? null,
        } : null,
        ingredients: mappedIngredients,
        dataCompleteness,
      });

      const [saved] = await tx.insert(productEvaluationsTable).values({
        productId: product.id,
        rulesetVersion: result.rulesetVersion,
        overallScore: result.overallScore,
        nutritionScore: result.nutritionScore,
        additiveScore: result.additiveScore,
        scoreGrade: result.scoreGrade,
        verdict: result.verdict,
        verdictZh: result.verdictZh,
        verificationStatus: "provisional",
        dataCompleteness: String(dataCompleteness),
        evidenceConfidence: result.evidenceConfidence,
        topReasons: result.topReasons,
        additiveFlags: result.additiveFlags,
      }).returning();

      await tx.update(productSubmissionsTable).set({
        resolvedProductId: product.id,
        provisionalScore: result.overallScore,
        provisionalGrade: result.scoreGrade,
        updatedAt: new Date(),
      }).where(eq(productSubmissionsTable.id, submission.id));

      return {
        status: 200 as const,
        body: {
          productId: product.id,
          overallScore: saved.overallScore,
          scoreGrade: saved.scoreGrade,
          analysisScope: result.analysisScope,
        },
      };
    });

    if (outcome.status === 200) { res.json(outcome.body); return; }
    res.status(outcome.status).json({ error: outcome.error });
  } catch (err) {
    req.log.error({ err }, "Finalize submission failed");
    res.status(500).json({ error: "Failed to finalize submission" });
  }
});

export default router;
