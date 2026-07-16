import { Router, type IRouter } from "express";
import { eq, ilike, or, desc } from "drizzle-orm";
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

const router: IRouter = Router();

async function buildProductSummary(p: typeof productsTable.$inferSelect) {
  const [brand] = p.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, p.brandId)) : [null];
  const [category] = p.categoryId ? await db.select().from(categoriesTable).where(eq(categoriesTable.id, p.categoryId)) : [null];
  const [barcode] = await db.select().from(barcodesTable).where(eq(barcodesTable.productId, p.id)).limit(1);
  const [priceRow] = await db.select({ priceNtd: productRetailerPricesTable.priceNtd, retailerId: productRetailerPricesTable.retailerId })
    .from(productRetailerPricesTable).where(eq(productRetailerPricesTable.productId, p.id)).limit(1);
  const [retailer] = priceRow?.retailerId ? await db.select().from(retailersTable).where(eq(retailersTable.id, priceRow.retailerId)) : [null];

  // Get latest evaluation score
  const { productEvaluationsTable } = await import("@workspace/db");
  const [evalRow] = await db.select({ overallScore: productEvaluationsTable.overallScore, scoreGrade: productEvaluationsTable.scoreGrade })
    .from(productEvaluationsTable).where(eq(productEvaluationsTable.productId, p.id))
    .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);

  return {
    id: p.id,
    name: p.name,
    nameZh: p.nameZh,
    brandName: brand?.name ?? null,
    imageUrl: p.imageUrl,
    categorySlug: category?.slug ?? null,
    categoryName: category?.name ?? null,
    verificationStatus: p.verificationStatus,
    overallScore: evalRow?.overallScore ?? null,
    scoreGrade: evalRow?.scoreGrade ?? null,
    barcode: barcode?.barcode ?? null,
    retailerName: retailer?.name ?? null,
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
    .orderBy(desc(productsTable.updatedAt)).limit(limit);

  const summaries = await Promise.all(rows.map(buildProductSummary));
  res.json(summaries);
});

router.get("/products/barcode/:barcode", async (req, res): Promise<void> => {
  const params = GetProductByBarcodeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [barcodeRow] = await db.select().from(barcodesTable).where(eq(barcodesTable.barcode, params.data.barcode));
  if (!barcodeRow) { res.status(404).json({ error: "Product not found for this barcode" }); return; }

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

  return {
    id: p.id,
    name: p.name,
    nameZh: p.nameZh,
    brandName: brand?.name ?? null,
    imageUrl: p.imageUrl,
    barcode: barcode?.barcode ?? null,
    categorySlug: category?.slug ?? null,
    categoryName: category?.name ?? null,
    categoryNameZh: category?.nameZh ?? null,
    verificationStatus: p.verificationStatus,
    dataCompleteness: p.dataCompleteness ? parseFloat(p.dataCompleteness) : null,
    retailerName: retailer?.name ?? null,
    retailerId: retailer?.id ?? null,
    priceNtd: priceRow?.priceNtd ? parseFloat(priceRow.priceNtd) : null,
    netWeight: p.netWeight,
    ingredientsList: p.ingredientsList,
    ingredients: ingredientRows.map(r => ({
      id: r.ing?.id ?? 0,
      name: r.pi.rawName,
      nameZh: r.ing?.nameZh ?? null,
      riskLevel: r.ing?.riskLevel ?? null,
      riskReason: r.ing?.riskReason ?? null,
      evidenceStrength: r.ing?.evidenceStrength ?? null,
      isAdditive: r.ing?.isAdditive === "true",
    })),
    nutritionFacts: nutrition ? {
      id: nutrition.id,
      productId: nutrition.productId,
      servingSize: nutrition.servingSize,
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
    allergens: allergenRows.map(r => ({
      name: r.al?.name ?? "Unknown",
      nameZh: r.al?.nameZh ?? null,
      severity: r.al?.severity ?? "moderate",
      source: r.pa.sourceType,
    })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
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
