import { Router, type IRouter } from "express";
import { eq, ilike, or, desc, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  productsTable, brandsTable, barcodesTable, categoriesTable,
  nutritionFactsTable, productIngredientsTable, ingredientsTable,
  productAllergensTable, allergensTable, productRetailerPricesTable, retailersTable,
  dataCorrectionsTable,
} from "@workspace/db";
import {
  GetProductByBarcodeParams, GetProductParams, ListProductsQueryParams,
  ListRecentProductsQueryParams, SubmitCorrectionBody,
} from "@workspace/api-zod";
import { RULESET_VERSION } from "../lib/scoring.js";
import {
  getTrustedProductEvidenceByBarcode,
  isValidGtin,
  resolveCatalogProduct,
} from "../lib/catalogEvidence.js";
import {
  lookupOpenFoodFacts,
  lookupStagedBarcodeResolution,
  resolveExternalBarcodeCandidates,
  stageOpenFoodFactsCandidate,
} from "../lib/openFoodFacts.js";
import {
  extractDeclaredAllergens,
  mapIngredientList,
  splitIngredientList,
} from "../lib/ingredientEvidence.js";
import { resolveConvenienceRetailer } from "../lib/convenienceRetailer.js";
import {
  discoverBarcodeFromWeb,
  stageWebBarcodeCandidate,
} from "../lib/webBarcodeDiscovery.js";
import { normalizeRetailGtin, retailGtinLookupVariants } from "../lib/barcodeIdentity.js";

const router: IRouter = Router();
const WEB_BARCODE_RATE_LIMIT = 12;
const WEB_BARCODE_RATE_WINDOW_MS = 10 * 60 * 1000;
const webBarcodeRateBuckets = new Map<string, { count: number; resetAt: number }>();

function canRunWebBarcodeLookup(clientId: string): boolean {
  const now = Date.now();
  const current = webBarcodeRateBuckets.get(clientId);
  if (!current || current.resetAt <= now) {
    if (webBarcodeRateBuckets.size >= 5_000) webBarcodeRateBuckets.delete(webBarcodeRateBuckets.keys().next().value ?? "");
    webBarcodeRateBuckets.set(clientId, { count: 1, resetAt: now + WEB_BARCODE_RATE_WINDOW_MS });
    return true;
  }
  if (current.count >= WEB_BARCODE_RATE_LIMIT) return false;
  current.count += 1;
  return true;
}

async function buildProductSummary(p: typeof productsTable.$inferSelect) {
  const [brand] = p.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, p.brandId)) : [null];
  const [category] = p.categoryId ? await db.select().from(categoriesTable).where(eq(categoriesTable.id, p.categoryId)) : [null];
  const [barcode] = await db.select().from(barcodesTable).where(eq(barcodesTable.productId, p.id)).limit(1);
  const [priceRow] = await db.select({ priceNtd: productRetailerPricesTable.priceNtd, retailerId: productRetailerPricesTable.retailerId })
    .from(productRetailerPricesTable).where(eq(productRetailerPricesTable.productId, p.id)).limit(1);
  const [retailer] = priceRow?.retailerId ? await db.select().from(retailersTable).where(eq(retailersTable.id, priceRow.retailerId)) : [null];

  // Get latest evaluation score
  const { productEvaluationsTable } = await import("@workspace/db");
  const [evalRow] = await db.select({
    overallScore: productEvaluationsTable.overallScore,
    scoreGrade: productEvaluationsTable.scoreGrade,
    rulesetVersion: productEvaluationsTable.rulesetVersion,
  })
    .from(productEvaluationsTable).where(eq(productEvaluationsTable.productId, p.id))
    .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);

  const presentation = resolveCatalogProduct(p, barcode?.barcode, brand);
  const canShowScore = presentation.verificationStatus === "verified" && evalRow?.rulesetVersion === RULESET_VERSION;
  const retailerIdentity = resolveConvenienceRetailer({
    barcode: presentation.barcode,
    explicitRetailerName: retailer?.name,
    explicitRetailerSlug: retailer?.slug,
    brandNames: [presentation.evidence?.brandName, presentation.evidence?.brandNameZh, presentation.brandName],
    productNames: [presentation.name, presentation.nameZh],
    sourceUrls: [presentation.evidence?.productSourceUrl, presentation.evidence?.barcodeSourceUrl],
  });

  return {
    id: p.id,
    name: presentation.name,
    nameZh: presentation.nameZh,
    brandName: presentation.brandName,
    imageUrl: presentation.imageUrl,
    categorySlug: category?.slug ?? null,
    categoryName: category?.name ?? null,
    verificationStatus: presentation.verificationStatus,
    overallScore: canShowScore ? evalRow.overallScore : null,
    scoreGrade: canShowScore ? evalRow.scoreGrade : null,
    barcode: presentation.barcode,
    retailerName: retailer?.name ?? retailerIdentity.retailerName,
    retailerSlug: retailer?.slug ?? retailerIdentity.retailerSlug,
    retailerConfidence: retailer ? "confirmed" : retailerIdentity.retailerConfidence,
    retailerEvidence: retailer ? "retailer_record" : retailerIdentity.retailerEvidence,
    retailerReasonZh: retailer
      ? "商品紀錄已明確連結此販售通路。"
      : retailerIdentity.retailerReasonZh,
    priceNtd: priceRow?.priceNtd ? parseFloat(priceRow.priceNtd) : null,
  };
}

router.get("/products", async (req, res): Promise<void> => {
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { q, limit = 20, offset = 0 } = parsed.data;

  const rows = await db.select().from(productsTable)
    .where(q ? or(ilike(productsTable.name, `%${q}%`), ilike(productsTable.nameZh, `%${q}%`)) : undefined)
    .orderBy(desc(productsTable.updatedAt))
    .limit(limit).offset(offset);

  const summaries = await Promise.all(rows.map(buildProductSummary));
  res.json(summaries);
});

router.get("/products/recent", async (req, res): Promise<void> => {
  const parsed = ListRecentProductsQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 6) : 6;

  const rows = await db.select().from(productsTable)
    .where(eq(productsTable.verificationStatus, "verified"))
    .orderBy(desc(productsTable.updatedAt)).limit(Math.max(limit * 4, 24));

  const summaries = await Promise.all(rows.map(buildProductSummary));
  res.json(summaries.filter(item => item.verificationStatus === "verified").slice(0, limit));
});

router.get("/products/barcode/:barcode", async (req, res): Promise<void> => {
  const params = GetProductByBarcodeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  if (!isValidGtin(params.data.barcode)) {
    res.status(422).json({ error: "Barcode check digit is invalid" });
    return;
  }

  const normalizedBarcode = normalizeRetailGtin(params.data.barcode)!;
  const barcodeVariants = retailGtinLookupVariants(params.data.barcode);

  const trustedMatches = barcodeVariants
    .map(getTrustedProductEvidenceByBarcode)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const trustedProductIds = [...new Set(trustedMatches.map(item => item.productId))];
  if (trustedProductIds.length > 1) {
    req.log.error({ barcode: params.data.barcode, barcodeVariants, productIds: trustedProductIds }, "conflicting trusted barcode mappings");
    res.status(404).json({
      error: "Conflicting trusted product identities exist for an equivalent barcode",
      identityStatus: "conflict",
      normalizedBarcode,
      catalogCandidate: null,
      identityCandidates: [],
      requiredCapture: "front_and_label",
      retailerIdentity: resolveConvenienceRetailer({ barcode: normalizedBarcode }),
    });
    return;
  }
  const barcodeRows = trustedProductIds[0]
    ? [{ productId: trustedProductIds[0] }]
    : await db.select().from(barcodesTable).where(inArray(barcodesTable.barcode, barcodeVariants));
  const productIds = [...new Set(barcodeRows.map(row => row.productId))];
  if (productIds.length > 1) {
    req.log.error({ barcode: params.data.barcode, barcodeVariants, productIds }, "conflicting canonical barcode mappings");
    res.status(404).json({
      error: "Conflicting product identities exist for an equivalent barcode",
      identityStatus: "conflict",
      normalizedBarcode,
      catalogCandidate: null,
      identityCandidates: [],
      requiredCapture: "front_and_label",
      retailerIdentity: resolveConvenienceRetailer({ barcode: normalizedBarcode }),
    });
    return;
  }
  const barcodeRow = barcodeRows[0];
  if (!barcodeRow) {
    let resolution = await lookupStagedBarcodeResolution(barcodeVariants);
    if (!resolution.candidate || resolution.status === "conflict") {
      try {
        const externalResult = await lookupOpenFoodFacts(normalizedBarcode);
        if (externalResult) {
          resolution = resolveExternalBarcodeCandidates([
            ...resolution.candidates,
            externalResult.candidate,
          ]);
          // Staging is best-effort and never blocks the user-facing lookup.
          void stageOpenFoodFactsCandidate(externalResult).catch(err => {
            req.log.warn({ err, barcode: normalizedBarcode }, "failed to stage Open Food Facts candidate");
          });
        }
      } catch (err) {
        req.log.warn({ err, barcode: normalizedBarcode }, "external barcode lookup failed");
      }
    }
    if ((!resolution.candidate || resolution.status === "conflict") && canRunWebBarcodeLookup(req.ip || "unknown")) {
      const webResult = await discoverBarcodeFromWeb(params.data.barcode);
      if (webResult) {
        resolution = resolveExternalBarcodeCandidates([
          ...resolution.candidates,
          webResult.candidate,
        ]);
        // Persist only as an unverified candidate. The physical label still
        // has to be confirmed before FACTA creates or scores a product.
        void stageWebBarcodeCandidate(webResult).catch(err => {
          req.log.warn({ err, barcode: params.data.barcode }, "failed to stage web barcode candidate");
        });
      }
    }
    const catalogCandidate = resolution.candidate;
    const retailerIdentity = catalogCandidate
      ? {
          retailerName: catalogCandidate.retailerName,
          retailerSlug: catalogCandidate.retailerSlug,
          retailerConfidence: catalogCandidate.retailerConfidence,
          retailerEvidence: catalogCandidate.retailerEvidence,
          retailerReasonZh: catalogCandidate.retailerReasonZh,
        }
      : resolveConvenienceRetailer({ barcode: normalizedBarcode });
    res.status(404).json({
      error: resolution.status === "conflict"
        ? "Exact-barcode sources disagree; verify the physical package"
        : catalogCandidate
        ? "Product identity found in public data; physical label verification is required"
        : "Product not found for this barcode",
      identityStatus: resolution.status,
      normalizedBarcode,
      catalogCandidate,
      identityCandidates: resolution.status === "conflict" ? resolution.candidates : [],
      requiredCapture: catalogCandidate ? "ingredients_and_nutrition" : "front_and_label",
      retailerIdentity,
    });
    return;
  }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, barcodeRow.productId));
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const full = await buildFullProduct(product);
  res.json(full);
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  res.json(await buildFullProduct(product));
});

async function buildFullProduct(p: typeof productsTable.$inferSelect) {
  const [brand] = p.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, p.brandId)) : [null];
  const [category] = p.categoryId ? await db.select().from(categoriesTable).where(eq(categoriesTable.id, p.categoryId)) : [null];
  const [barcode] = await db.select().from(barcodesTable).where(eq(barcodesTable.productId, p.id)).limit(1);
  const [nutrition] = await db.select().from(nutritionFactsTable).where(eq(nutritionFactsTable.productId, p.id));
  const [priceRow] = await db.select({ priceNtd: productRetailerPricesTable.priceNtd, retailerId: productRetailerPricesTable.retailerId, id: productRetailerPricesTable.id })
    .from(productRetailerPricesTable).where(eq(productRetailerPricesTable.productId, p.id)).limit(1);
  const [retailer] = priceRow?.retailerId ? await db.select().from(retailersTable).where(eq(retailersTable.id, priceRow.retailerId)) : [null];

  const ingredientRows = await db
    .select({ pi: productIngredientsTable, ing: ingredientsTable })
    .from(productIngredientsTable)
    .leftJoin(ingredientsTable, eq(productIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(productIngredientsTable.productId, p.id))
    .orderBy(productIngredientsTable.position);

  const allergenRows = await db
    .select({ pa: productAllergensTable, al: allergensTable })
    .from(productAllergensTable)
    .leftJoin(allergensTable, eq(productAllergensTable.allergenId, allergensTable.id))
    .where(eq(productAllergensTable.productId, p.id));

  const presentation = resolveCatalogProduct(p, barcode?.barcode, brand);
  const retailerIdentity = resolveConvenienceRetailer({
    barcode: presentation.barcode,
    explicitRetailerName: retailer?.name,
    explicitRetailerSlug: retailer?.slug,
    brandNames: [presentation.evidence?.brandName, presentation.evidence?.brandNameZh, presentation.brandName],
    productNames: [presentation.name, presentation.nameZh],
    sourceUrls: [presentation.evidence?.productSourceUrl, presentation.evidence?.barcodeSourceUrl],
  });
  const trustedNutrition = presentation.evidence?.nutrition ?? null;
  const canUseDatabaseEvidence = presentation.verificationStatus !== "catalog_unverified";
  const resolvedNutrition = trustedNutrition ?? (canUseDatabaseEvidence && nutrition ? {
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
  } : null);

  const trustedIngredientNames = presentation.evidence
    ? splitIngredientList(presentation.evidence.ingredientsList)
    : null;
  const mappedRawIngredients = !trustedIngredientNames && canUseDatabaseEvidence && ingredientRows.length === 0
    ? mapIngredientList(presentation.ingredientsList)
    : [];
  const resolvedIngredients = trustedIngredientNames
    ? trustedIngredientNames.map((name, index) => ({
        id: -(index + 1),
        name,
        nameZh: name,
        riskLevel: "unknown",
        riskReason: null,
        evidenceStrength: null,
        isAdditive: false,
      }))
    : canUseDatabaseEvidence && ingredientRows.length > 0
      ? ingredientRows.map(r => ({
          id: r.ing?.id ?? 0,
          name: r.pi.rawName,
          nameZh: r.ing?.nameZh ?? null,
          riskLevel: r.ing?.riskLevel ?? null,
          riskReason: r.ing?.riskReason ?? null,
          evidenceStrength: r.ing?.evidenceStrength ?? null,
          isAdditive: r.ing?.isAdditive === "true",
        }))
      : mappedRawIngredients.map((ingredient, index) => ({
          id: -(index + 1),
          name: ingredient.name,
          nameZh: ingredient.name,
          riskLevel: ingredient.riskLevel,
          riskReason: ingredient.riskReasonZh ?? ingredient.riskReason,
          evidenceStrength: ingredient.evidenceStrength,
          isAdditive: ingredient.isAdditive === "true",
        }));

  const databaseAllergens = allergenRows.map(r => ({
        name: r.al?.name ?? "Unknown",
        nameZh: r.al?.nameZh ?? null,
        severity: r.al?.severity ?? "moderate",
        source: r.pa.sourceType,
      }));
  const declaredAllergens = extractDeclaredAllergens(presentation.ingredientsList);
  const resolvedAllergens = presentation.evidence?.allergens ?? (canUseDatabaseEvidence
    ? declaredAllergens.length > 0 ? declaredAllergens : databaseAllergens
    : []);

  return {
    id: p.id,
    name: presentation.name,
    nameZh: presentation.nameZh,
    brandName: presentation.brandName,
    imageUrl: presentation.imageUrl,
    barcode: presentation.barcode,
    categorySlug: category?.slug ?? null,
    categoryName: category?.name ?? null,
    categoryNameZh: category?.nameZh ?? null,
    verificationStatus: presentation.verificationStatus,
    dataCompleteness: presentation.evidence ? 1 : (p.dataCompleteness ? parseFloat(p.dataCompleteness) : null),
    retailerName: retailer?.name ?? retailerIdentity.retailerName,
    retailerSlug: retailer?.slug ?? retailerIdentity.retailerSlug,
    retailerConfidence: retailer ? "confirmed" : retailerIdentity.retailerConfidence,
    retailerEvidence: retailer ? "retailer_record" : retailerIdentity.retailerEvidence,
    retailerReasonZh: retailer
      ? "商品紀錄已明確連結此販售通路。"
      : retailerIdentity.retailerReasonZh,
    retailerId: retailer?.id ?? null,
    priceNtd: priceRow?.priceNtd ? parseFloat(priceRow.priceNtd) : null,
    netWeight: presentation.evidence?.netWeight ?? p.netWeight,
    catalogSourceUrl: presentation.evidence?.productSourceUrl ?? null,
    barcodeSourceUrl: presentation.evidence?.barcodeSourceUrl ?? null,
    ingredientsList: presentation.ingredientsList,
    ingredients: resolvedIngredients,
    nutritionFacts: resolvedNutrition ? {
      id: nutrition?.id ?? 0,
      productId: p.id,
      ...resolvedNutrition,
    } : null,
    allergens: resolvedAllergens,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function parseNullableNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Data corrections
router.post("/corrections", async (req, res): Promise<void> => {
  const parsed = SubmitCorrectionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [correction] = await db.insert(dataCorrectionsTable).values({
    productId: parsed.data.productId,
    issueType: parsed.data.issueType,
    description: parsed.data.description ?? null,
    userSession: parsed.data.userSession ?? null,
  }).returning();

  res.status(201).json({
    id: correction.id,
    productId: correction.productId,
    issueType: correction.issueType,
    description: correction.description,
    status: correction.status,
    userSession: correction.userSession,
    createdAt: correction.createdAt.toISOString(),
  });
});

export default router;
