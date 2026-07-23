import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { retailersTable, categoriesTable, scanEventsTable, productsTable, productSubmissionsTable } from "@workspace/db";

const router: IRouter = Router();

async function catalogCoverageStats() {
  try {
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM catalog_import_candidates
          WHERE verification_status IN ('imported_unverified', 'pending_review')) AS source_candidates,
        (SELECT count(*)::int FROM catalog_import_candidates
          WHERE verification_status IN ('imported_unverified', 'pending_review') AND gtin IS NOT NULL) AS barcode_candidate_rows,
        (SELECT count(distinct gtin)::int FROM catalog_import_candidates
          WHERE verification_status IN ('imported_unverified', 'pending_review') AND gtin IS NOT NULL) AS barcode_candidates,
        (SELECT count(*)::int FROM (
          SELECT gtin FROM catalog_import_candidates
          WHERE verification_status IN ('imported_unverified', 'pending_review') AND gtin IS NOT NULL
          GROUP BY gtin HAVING count(distinct canonical_key) > 1
        ) conflicts) AS barcode_identity_conflicts,
        (SELECT count(*)::int FROM catalog_import_candidates
          WHERE verification_status IN ('imported_unverified', 'pending_review')
            AND evidence_tier IN ('nutrition_ready', 'ingredients_ready', 'review_ready')) AS evidence_candidates,
        (SELECT count(*)::int FROM catalog_import_candidates
          WHERE verification_status IN ('imported_unverified', 'pending_review')
            AND nutrition_analysis_eligible = true) AS nutrition_candidates,
        (SELECT count(*)::int FROM facta_catalog_seed) AS retailer_catalog_products,
        (SELECT count(*)::int FROM catalog_import_candidates
          WHERE source_key = '7eleven_tw_freshfoods'
            AND verification_status IN ('imported_unverified', 'pending_review')) AS seven_eleven_official_products,
        (SELECT max(updated_at) FROM catalog_import_candidates) AS catalog_updated_at
    `);
    const rows = (result as any).rows ?? result;
    const row = rows[0] ?? {};
    return {
      sourceCandidates: Number(row.source_candidates ?? 0),
      barcodeCandidates: Number(row.barcode_candidates ?? 0),
      barcodeCandidateRows: Number(row.barcode_candidate_rows ?? 0),
      barcodeIdentityConflicts: Number(row.barcode_identity_conflicts ?? 0),
      evidenceCandidates: Number(row.evidence_candidates ?? 0),
      nutritionCandidates: Number(row.nutrition_candidates ?? 0),
      retailerCatalogProducts: Number(row.retailer_catalog_products ?? 0),
      sevenElevenOfficialProducts: Number(row.seven_eleven_official_products ?? 0),
      catalogUpdatedAt: row.catalog_updated_at ? new Date(row.catalog_updated_at).toISOString() : null,
    };
  } catch {
    // Catalog migrations can roll out before or after the application. The
    // canonical dashboard remains available during that gap.
    return {
      sourceCandidates: 0,
      barcodeCandidates: 0,
      barcodeCandidateRows: 0,
      barcodeIdentityConflicts: 0,
      evidenceCandidates: 0,
      nutritionCandidates: 0,
      retailerCatalogProducts: 0,
      sevenElevenOfficialProducts: 0,
      catalogUpdatedAt: null,
    };
  }
}

async function scientificEvidenceStats() {
  try {
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM scientific_evidence_sources) AS scientific_evidence_sources,
        (SELECT count(*)::int FROM scientific_evidence_sources
          WHERE integrity_status IN ('retracted', 'expression_of_concern')) AS scientific_integrity_excluded,
        (SELECT count(*)::int FROM scientific_evidence_topic_links
          WHERE consumer_use_status = 'eligible' AND review_status = 'reviewed') AS scientific_reviewed_links,
        (SELECT max(finished_at) FROM scientific_evidence_sync_runs
          WHERE status = 'completed') AS scientific_updated_at
    `);
    const rows = (result as any).rows ?? result;
    const row = rows[0] ?? {};
    return {
      scientificEvidenceSources: Number(row.scientific_evidence_sources ?? 0),
      scientificIntegrityExcluded: Number(row.scientific_integrity_excluded ?? 0),
      scientificReviewedLinks: Number(row.scientific_reviewed_links ?? 0),
      scientificUpdatedAt: row.scientific_updated_at ? new Date(row.scientific_updated_at).toISOString() : null,
    };
  } catch {
    return {
      scientificEvidenceSources: 0,
      scientificIntegrityExcluded: 0,
      scientificReviewedLinks: 0,
      scientificUpdatedAt: null,
    };
  }
}

router.get("/retailers", async (_req, res): Promise<void> => {
  const rows = await db.select().from(retailersTable);
  res.json(rows.map(r => ({ id: r.id, name: r.name, slug: r.slug, logoUrl: r.logoUrl })));
});

router.get("/categories", async (_req, res): Promise<void> => {
  const rows = await db.select().from(categoriesTable);
  res.json(rows.map(c => ({ id: c.id, name: c.name, slug: c.slug, nameZh: c.nameZh })));
});

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const [allProducts, totalScans, pendingReviews, coverage, science] = await Promise.all([
    db.select().from(productsTable),
    db.select().from(scanEventsTable),
    db.select().from(productSubmissionsTable).where(eq(productSubmissionsTable.status, "pending_review")),
    catalogCoverageStats(),
    scientificEvidenceStats(),
  ]);
  const verifiedProducts = allProducts.filter(p => p.verificationStatus === "verified");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const scansToday = totalScans.filter(s => s.createdAt >= today).length;

  res.json({
    totalProducts: allProducts.length,
    verifiedProducts: verifiedProducts.length,
    totalScans: totalScans.length,
    pendingReviews: pendingReviews.length,
    scansToday,
    ...coverage,
    barcodeCandidateRate: coverage.sourceCandidates > 0 ? coverage.barcodeCandidates / coverage.sourceCandidates : 0,
    ...science,
    discoverableRecords: verifiedProducts.length + coverage.sourceCandidates + coverage.retailerCatalogProducts,
    liveCatalogSearchEnabled: process.env.FACTA_LIVE_CATALOG_SEARCH_ENABLED !== "false",
  });
});

export default router;
