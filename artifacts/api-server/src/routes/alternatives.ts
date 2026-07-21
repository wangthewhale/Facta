import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  alternativeProductLinksTable, productsTable, brandsTable,
  productEvaluationsTable, barcodesTable, productRetailerPricesTable, retailersTable,
  categoriesTable,
} from "@workspace/db";
import { GetAlternativesParams } from "@workspace/api-zod";
import { RULESET_VERSION } from "../lib/scoring.js";
import { resolveCatalogProduct } from "../lib/catalogEvidence.js";

const router: IRouter = Router();

router.get("/alternatives/:productId", async (req, res): Promise<void> => {
  const params = GetAlternativesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const links = await db.select().from(alternativeProductLinksTable)
    .where(eq(alternativeProductLinksTable.productId, params.data.productId));

  const results = await Promise.all(links.map(async link => {
    const [altProduct] = await db.select().from(productsTable).where(eq(productsTable.id, link.alternativeProductId));
    if (!altProduct) return null;

    const [brand] = altProduct.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, altProduct.brandId)) : [null];
    const [category] = altProduct.categoryId ? await db.select().from(categoriesTable).where(eq(categoriesTable.id, altProduct.categoryId)) : [null];
    const [barcode] = await db.select().from(barcodesTable).where(eq(barcodesTable.productId, altProduct.id)).limit(1);
    const [priceRow] = await db.select({ priceNtd: productRetailerPricesTable.priceNtd, retailerId: productRetailerPricesTable.retailerId })
      .from(productRetailerPricesTable).where(eq(productRetailerPricesTable.productId, altProduct.id)).limit(1);
    const [retailer] = priceRow?.retailerId ? await db.select().from(retailersTable).where(eq(retailersTable.id, priceRow.retailerId)) : [null];
    const [evalRow] = await db.select({
      overallScore: productEvaluationsTable.overallScore,
      scoreGrade: productEvaluationsTable.scoreGrade,
      rulesetVersion: productEvaluationsTable.rulesetVersion,
    })
      .from(productEvaluationsTable).where(eq(productEvaluationsTable.productId, altProduct.id))
      .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);

    const presentation = resolveCatalogProduct(altProduct, barcode?.barcode, brand);
    if (presentation.verificationStatus !== "verified") return null;

    return {
      product: {
        id: altProduct.id,
        name: presentation.name,
        nameZh: presentation.nameZh,
        brandName: presentation.brandName,
        imageUrl: presentation.imageUrl,
        categorySlug: category?.slug ?? null,
        categoryName: category?.name ?? null,
        verificationStatus: presentation.verificationStatus,
        overallScore: evalRow?.rulesetVersion === RULESET_VERSION ? evalRow.overallScore : null,
        scoreGrade: evalRow?.rulesetVersion === RULESET_VERSION ? evalRow.scoreGrade : null,
        barcode: presentation.barcode,
        retailerName: retailer?.name ?? null,
        priceNtd: priceRow?.priceNtd ? parseFloat(priceRow.priceNtd) : null,
      },
      scoreImprovement: link.scoreImprovement,
      whyBetter: link.whyBetter,
      whyBetterZh: link.whyBetterZh,
      priceDifferenceNtd: link.priceDifferenceNtd ? parseFloat(link.priceDifferenceNtd) : null,
      sameRetailer: link.sameRetailer === "true",
    };
  }));

  res.json(results.filter(Boolean));
});

export default router;
