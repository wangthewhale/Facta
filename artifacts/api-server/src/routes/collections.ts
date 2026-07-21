import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  curatedCollectionsTable, collectionProductsTable, productsTable, brandsTable,
  retailersTable, goalsTable, barcodesTable, productEvaluationsTable, categoriesTable,
  productRetailerPricesTable, auditLogsTable,
} from "@workspace/db";
import {
  GetCollectionParams, ListCollectionsQueryParams,
  AdminCreateCollectionBody, AdminUpdateCollectionParams, AdminUpdateCollectionBody,
} from "@workspace/api-zod";
import { RULESET_VERSION } from "../lib/scoring.js";
import { resolveCatalogProduct } from "../lib/catalogEvidence.js";

const router: IRouter = Router();

async function collectionToSummary(c: typeof curatedCollectionsTable.$inferSelect) {
  const productCount = await db.select({ id: collectionProductsTable.id })
    .from(collectionProductsTable).where(eq(collectionProductsTable.collectionId, c.id))
    .then(r => r.length);

  return {
    id: c.id, slug: c.slug, name: c.name, nameZh: c.nameZh,
    descriptionZh: c.descriptionZh, goalId: c.goalId, retailerId: c.retailerId,
    mealType: c.mealType, status: c.status, productCount,
  };
}

router.get("/collections", async (req, res): Promise<void> => {
  const parsed = ListCollectionsQueryParams.safeParse(req.query);
  const goalSlug = parsed.success ? parsed.data.goal_slug : null;
  const mealType = parsed.success ? parsed.data.meal_type : null;
  const retailerSlug = parsed.success ? parsed.data.retailer_slug : null;

  let goalId: number | undefined;
  if (goalSlug) {
    const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.slug, goalSlug));
    goalId = goal?.id;
  }

  let retailerId: number | undefined;
  if (retailerSlug) {
    const [r] = await db.select().from(retailersTable).where(eq(retailersTable.slug, retailerSlug));
    retailerId = r?.id;
  }

  const rows = await db.select().from(curatedCollectionsTable)
    .where(and(
      eq(curatedCollectionsTable.status, "published"),
      goalId ? eq(curatedCollectionsTable.goalId, goalId) : undefined,
      mealType ? eq(curatedCollectionsTable.mealType, mealType) : undefined,
      retailerId ? eq(curatedCollectionsTable.retailerId, retailerId) : undefined,
    ))
    .orderBy(curatedCollectionsTable.sortOrder);

  const summaries = await Promise.all(rows.map(collectionToSummary));
  res.json(summaries);
});

router.get("/collections/:slug", async (req, res): Promise<void> => {
  const params = GetCollectionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [collection] = await db.select().from(curatedCollectionsTable)
    .where(eq(curatedCollectionsTable.slug, params.data.slug));
  if (!collection) { res.status(404).json({ error: "Collection not found" }); return; }

  const items = await db.select().from(collectionProductsTable)
    .where(eq(collectionProductsTable.collectionId, collection.id))
    .orderBy(collectionProductsTable.sortOrder);

  const products = await Promise.all(items.map(async item => {
    const [p] = await db.select().from(productsTable).where(eq(productsTable.id, item.productId));
    if (!p) return null;
    const [brand] = p.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, p.brandId)) : [null];
    const [category] = p.categoryId ? await db.select().from(categoriesTable).where(eq(categoriesTable.id, p.categoryId)) : [null];
    const [barcode] = await db.select().from(barcodesTable).where(eq(barcodesTable.productId, p.id)).limit(1);
    const [evalRow] = await db.select({
      overallScore: productEvaluationsTable.overallScore,
      scoreGrade: productEvaluationsTable.scoreGrade,
      rulesetVersion: productEvaluationsTable.rulesetVersion,
    })
      .from(productEvaluationsTable).where(eq(productEvaluationsTable.productId, p.id))
      .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);
    const [priceRow] = await db.select({ priceNtd: productRetailerPricesTable.priceNtd, retailerId: productRetailerPricesTable.retailerId })
      .from(productRetailerPricesTable).where(eq(productRetailerPricesTable.productId, p.id)).limit(1);
    const [retailer] = priceRow?.retailerId ? await db.select().from(retailersTable).where(eq(retailersTable.id, priceRow.retailerId)) : [null];

    const presentation = resolveCatalogProduct(p, barcode?.barcode, brand);
    if (presentation.verificationStatus !== "verified") return null;
    const canShowScore = evalRow?.rulesetVersion === RULESET_VERSION;

    return {
      product: {
        id: p.id, name: presentation.name, nameZh: presentation.nameZh,
        brandName: presentation.brandName, imageUrl: presentation.imageUrl,
        categorySlug: category?.slug ?? null, categoryName: category?.name ?? null,
        verificationStatus: presentation.verificationStatus,
        overallScore: canShowScore ? evalRow.overallScore : null,
        scoreGrade: canShowScore ? evalRow.scoreGrade : null,
        barcode: presentation.barcode,
        retailerName: retailer?.name ?? null,
        priceNtd: priceRow?.priceNtd ? parseFloat(priceRow.priceNtd) : null,
      },
      reason: item.reason,
      reasonZh: item.reasonZh,
    };
  }));

  const summary = await collectionToSummary(collection);
  res.json({ ...summary, products: products.filter(Boolean) });
});

// Admin
router.post("/admin/collections", async (req, res): Promise<void> => {
  const body = AdminCreateCollectionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [col] = await db.insert(curatedCollectionsTable).values({
    slug: body.data.slug ?? "",
    name: body.data.name ?? "",
    nameZh: body.data.nameZh ?? "",
    descriptionZh: body.data.descriptionZh ?? null,
    goalId: body.data.goalId ?? null,
    retailerId: body.data.retailerId ?? null,
    mealType: body.data.mealType ?? "any",
    status: body.data.status ?? "draft",
  }).returning();

  // Insert products
  if (body.data.productIds) {
    for (let i = 0; i < body.data.productIds.length; i++) {
      await db.insert(collectionProductsTable).values({
        collectionId: col.id, productId: body.data.productIds[i], sortOrder: i,
      });
    }
  }

  await db.insert(auditLogsTable).values({ entityType: "collection", entityId: col.id, action: "create", newValue: col });
  res.status(201).json(await collectionToSummary(col));
});

router.patch("/admin/collections/:id", async (req, res): Promise<void> => {
  const params = AdminUpdateCollectionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = AdminUpdateCollectionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const updates: Partial<typeof curatedCollectionsTable.$inferInsert> = { updatedAt: new Date() };
  if (body.data.nameZh !== undefined) updates.nameZh = body.data.nameZh;
  if (body.data.status !== undefined) updates.status = body.data.status;
  if (body.data.goalId !== undefined) updates.goalId = body.data.goalId;
  if (body.data.retailerId !== undefined) updates.retailerId = body.data.retailerId;
  if (body.data.mealType !== undefined) updates.mealType = body.data.mealType;

  const [updated] = await db.update(curatedCollectionsTable).set(updates)
    .where(eq(curatedCollectionsTable.id, params.data.id)).returning();
  if (!updated) { res.status(404).json({ error: "Collection not found" }); return; }

  await db.insert(auditLogsTable).values({ entityType: "collection", entityId: updated.id, action: "update", newValue: updates });
  res.json(await collectionToSummary(updated));
});

export default router;
