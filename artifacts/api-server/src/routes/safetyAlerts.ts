import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  productsTable,
  brandsTable,
  safetyAlertsTable,
  safetyAlertItemsTable,
} from "@workspace/db";
import { GetProductSafetyCheckParams } from "@workspace/api-zod";

const router: IRouter = Router();

function alertToApi(row: typeof safetyAlertsTable.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    titleZh: row.titleZh,
    summary: row.summary,
    summaryZh: row.summaryZh,
    contaminant: row.contaminant,
    contaminantZh: row.contaminantZh,
    severity: row.severity,
    officialUrl: row.officialUrl,
    sourceUrls: (row.sourceUrls ?? []) as string[],
    publishedAt: row.publishedAt.toISOString(),
  };
}

/** List active government food-safety alerts (newest first). */
router.get("/safety-alerts", async (_req, res): Promise<void> => {
  const alerts = await db.select().from(safetyAlertsTable)
    .where(eq(safetyAlertsTable.active, true))
    .orderBy(desc(safetyAlertsTable.publishedAt));
  res.json({ alerts: alerts.map(alertToApi) });
});

/**
 * Check whether a product/brand matches any active safety alert.
 * Matching is case-insensitive substring against brand + product names.
 */
router.get("/products/:id/safety-check", async (req, res): Promise<void> => {
  const params = GetProductSafetyCheckParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const [brand] = product.brandId
    ? await db.select().from(brandsTable).where(eq(brandsTable.id, product.brandId))
    : [null];

  const haystack = [
    brand?.name, brand?.nameZh, product.name, product.nameZh,
  ].filter(Boolean).join(" ").toLowerCase();

  const alerts = await db.select().from(safetyAlertsTable).where(eq(safetyAlertsTable.active, true));
  const matches: Array<{ alert: ReturnType<typeof alertToApi>; matchedBusiness: string; matchedKeyword: string; productExamples: string[] }> = [];

  for (const alert of alerts) {
    const items = await db.select().from(safetyAlertItemsTable)
      .where(eq(safetyAlertItemsTable.alertId, alert.id));
    for (const item of items) {
      const keywords = (item.matchKeywords ?? []) as string[];
      const hit = keywords.find(k => k.length >= 2 && haystack.includes(k.toLowerCase()));
      if (hit) {
        matches.push({
          alert: alertToApi(alert),
          matchedBusiness: item.businessName,
          matchedKeyword: hit,
          productExamples: ((item.productExamples ?? []) as string[]).slice(0, 5),
        });
        break; // one match per alert is enough
      }
    }
  }

  res.json({ affected: matches.length > 0, matches });
});

export default router;
