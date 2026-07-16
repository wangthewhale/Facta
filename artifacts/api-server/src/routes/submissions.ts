import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  productSubmissionsTable, productsTable, brandsTable, barcodesTable,
  nutritionFactsTable, productEvaluationsTable,
} from "@workspace/db";
import {
  GetSubmissionParams, ConfirmOcrParams, ConfirmOcrBody,
  CreateSubmissionBody, ProcessOcrBody, FinalizeSubmissionParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { calculateScore } from "../lib/scoring.js";

const router: IRouter = Router();

function submissionToApi(s: typeof productSubmissionsTable.$inferSelect) {
  return {
    id: s.id,
    productName: s.productName,
    brandName: s.brandName,
    barcode: s.barcode,
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

  const { imageBase64, imageType = "ingredients" } = parsed.data;

  try {
    const systemPrompt = `You are an OCR assistant for FACTA, a food product intelligence app in Taiwan.
Extract text from food product label images. Return a JSON object with:
- extractedText: the full raw text extracted
- rawIngredients: the ingredients list if visible (as a single string)
- parsedNutrition: an object with numeric nutrition values if a nutrition facts panel is visible
  (calories, totalFat, saturatedFat, transFat, sodium, totalCarbs, dietaryFiber, totalSugars, protein — all in standard units)
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
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
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

    res.json({
      extractedText: parsed2.extractedText ?? content,
      confidence: parsed2.confidence ?? 0.5,
      structuredData: parsed2,
      rawIngredients: parsed2.rawIngredients ?? null,
      parsedNutrition: parsed2.parsedNutrition ?? null,
    });
  } catch (err) {
    // Demo fallback when AI is unavailable
    req.log.warn({ err }, "OCR AI unavailable, returning demo result");
    res.json({
      extractedText: "[Demo mode] 水、砂糖、麥芽糖漿、鹽、香料",
      confidence: 0.3,
      structuredData: {},
      rawIngredients: "水、砂糖、麥芽糖漿、鹽、香料",
      parsedNutrition: null,
    });
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

  const [updated] = await db.update(productSubmissionsTable).set({
    extractedIngredients: body.data.confirmedIngredients,
    extractedNutrition: body.data.confirmedNutrition ?? null,
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
          },
        };
      }

      // Precondition: only finalize submissions with confirmed OCR data
      if (submission.ocrStatus !== "confirmed" || !submission.extractedIngredients) {
        return { status: 409 as const, error: "Submission has no confirmed OCR data to finalize" };
      }

      // Brand: atomic upsert by slug
      let brandId: number | null = null;
      if (submission.brandName) {
        const slug = submission.brandName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").slice(0, 60) || "unknown";
        const [brand] = await tx.insert(brandsTable)
          .values({ name: submission.brandName, slug })
          .onConflictDoUpdate({ target: brandsTable.slug, set: { updatedAt: new Date() } })
          .returning();
        brandId = brand.id;
      }

      const nutrition = (submission.extractedNutrition ?? null) as Record<string, number | null> | null;
      const hasNutrition = nutrition && Object.values(nutrition).some(v => v != null);
      const dataCompleteness = hasNutrition ? 0.6 : 0.4;

      // Create provisional product
      const [product] = await tx.insert(productsTable).values({
        name: submission.productName,
        brandId,
        verificationStatus: "provisional",
        dataCompleteness: String(dataCompleteness),
        ingredientsList: submission.extractedIngredients,
      }).returning();

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
        nutrition: hasNutrition && nutrition ? {
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
        ingredients: [],
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
        body: { productId: product.id, overallScore: saved.overallScore, scoreGrade: saved.scoreGrade },
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
