import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  productsTable,
  brandsTable,
  barcodesTable,
  productRetailerPricesTable,
  retailersTable,
  safetyAlertsTable,
  safetyAlertItemsTable,
} from "@workspace/db";
import { GetProductSafetyCheckParams } from "@workspace/api-zod";
import { resolveCatalogProduct } from "../lib/catalogEvidence.js";
import {
  getConvenienceRetailerSearchTerms,
  resolveConvenienceRetailer,
} from "../lib/convenienceRetailer.js";
import { matchSafetyAlertItem } from "../lib/safetyAlertMatching.js";
import { lookupTfdaOilRecallByProduct, TFDA_OIL_RECALL_URL } from "../lib/tfdaOilRecall.js";

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
 * Check whether a product, brand or confirmed retailer matches an active alert.
 * Exact-product impact and business-level context are intentionally separate.
 */
router.get("/products/:id/safety-check", async (req, res): Promise<void> => {
  const params = GetProductSafetyCheckParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const [brand] = product.brandId
    ? await db.select().from(brandsTable).where(eq(brandsTable.id, product.brandId))
    : [null];
  const [barcode] = await db.select().from(barcodesTable)
    .where(eq(barcodesTable.productId, product.id)).limit(1);
  const [priceRow] = await db.select({ retailerId: productRetailerPricesTable.retailerId })
    .from(productRetailerPricesTable).where(eq(productRetailerPricesTable.productId, product.id)).limit(1);
  const [retailer] = priceRow?.retailerId
    ? await db.select().from(retailersTable).where(eq(retailersTable.id, priceRow.retailerId))
    : [null];

  const catalogProduct = resolveCatalogProduct(product, barcode?.barcode, brand);
  const retailerIdentity = resolveConvenienceRetailer({
    barcode: catalogProduct.barcode,
    explicitRetailerName: retailer?.name,
    explicitRetailerSlug: retailer?.slug,
    brandNames: [catalogProduct.evidence?.brandName, catalogProduct.evidence?.brandNameZh, catalogProduct.brandName],
    productNames: [catalogProduct.name, catalogProduct.nameZh],
    sourceUrls: [catalogProduct.evidence?.productSourceUrl, catalogProduct.evidence?.barcodeSourceUrl],
  });
  const hasUserConfirmedIdentity = product.verificationStatus === "provisional" &&
    Boolean(barcode?.barcode && product.name.trim() && (brand?.name?.trim() || retailerIdentity.retailerSlug));
  if (catalogProduct.verificationStatus !== "verified" && !hasUserConfirmedIdentity) {
    res.json({ affected: false, relatedBusinessReported: false, matches: [] });
    return;
  }

  const productNames = [
    catalogProduct.name,
    catalogProduct.nameZh,
  ].filter((value): value is string => Boolean(value));
  const businessNames = [
    catalogProduct.evidence?.brandName,
    catalogProduct.evidence?.brandNameZh,
    catalogProduct.brandName,
    retailer?.name,
    retailerIdentity.retailerName,
    ...getConvenienceRetailerSearchTerms(retailerIdentity.retailerSlug),
  ].filter((value): value is string => Boolean(value));

  const alerts = await db.select().from(safetyAlertsTable).where(eq(safetyAlertsTable.active, true));
  const matches: Array<{
    alert: ReturnType<typeof alertToApi>;
    matchedBusiness: string;
    matchedKeyword: string;
    matchedProductExample: string | null;
    productExamples: string[];
    matchScope: "exact_product" | "business";
    affectsProduct: true | null;
    statusZh: string;
  }> = [];

  for (const alert of alerts) {
    const items = await db.select().from(safetyAlertItemsTable)
      .where(eq(safetyAlertItemsTable.alertId, alert.id));
    for (const item of items) {
      const keywords = (item.matchKeywords ?? []) as string[];
      const productExamples = (item.productExamples ?? []) as string[];
      const decision = matchSafetyAlertItem(
        { barcode: catalogProduct.barcode, productNames, businessNames },
        { businessName: item.businessName, matchKeywords: keywords, productExamples },
      );
      if (decision) {
        matches.push({
          alert: alertToApi(alert),
          matchedBusiness: item.businessName,
          matchedKeyword: decision.matchedKeyword,
          matchedProductExample: decision.matchedProductExample,
          productExamples: productExamples.slice(0, 5),
          matchScope: decision.matchScope,
          affectsProduct: decision.affectsProduct,
          statusZh: decision.statusZh,
        });
        break; // one match per alert is enough
      }
    }
  }

  const oilRecallRelevantText = [
    catalogProduct.name,
    catalogProduct.nameZh,
    catalogProduct.ingredientsList,
  ].filter(Boolean).join(" ");
  if (/(油|脂|沙拉|美乃滋|三明治|飯糰|便當|漢堡|捲餅|醬|麵包|油炸)/i.test(oilRecallRelevantText)) {
    const official = await lookupTfdaOilRecallByProduct(productNames, businessNames);
    const alreadyExact = matches.some(match => match.affectsProduct === true);
    if (!alreadyExact && official.rows.length > 0) {
      const publishedAt = new Date(official.lastUpdated ?? "2026-07-01T00:00:00+08:00").toISOString();
      for (const row of official.rows.slice(0, 5)) {
        const batchDetails = [
          row.batch ? `批號 ${row.batch}` : null,
          row.expiry ? `有效日期／範圍 ${row.expiry}` : null,
        ].filter(Boolean).join("；");
        matches.push({
          alert: {
            id: -1,
            slug: "tfda-chunglien-oil-live-list",
            title: "TFDA mandatory withdrawal list for the Chung Lien oil incident",
            titleZh: "食藥署中聯油脂案強制下架清單",
            summary: "The current TFDA database names this product in the mandatory withdrawal list. Verify the applicable batch and expiry details before consumption.",
            summaryZh: `食藥署最新強制下架資料庫列出「${row.productName}」（業者：${row.businessName}）${batchDetails ? `；${batchDetails}` : ""}。`,
            contaminant: "Benzo(a)pyrene (BaP)",
            contaminantZh: "苯(a)駢芘（BaP）",
            severity: "high",
            officialUrl: TFDA_OIL_RECALL_URL,
            sourceUrls: [official.sourceUrl],
            publishedAt,
          },
          matchedBusiness: row.businessName,
          matchedKeyword: row.productName,
          matchedProductExample: row.productName,
          productExamples: [row.productName],
          matchScope: "exact_product",
          affectsProduct: true,
          statusZh: `官方即時清單可直接對應這款商品；先不要食用，請核對${batchDetails || "食藥署公告中的批號與有效日期"}。`,
        });
      }
    }
  }

  res.json({
    affected: matches.some(match => match.affectsProduct === true),
    relatedBusinessReported: matches.some(match => match.affectsProduct !== true),
    matches,
  });
});

export default router;
