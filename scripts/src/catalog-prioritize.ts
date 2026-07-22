import { calculateCatalogPriority } from "./catalog/catalogPriority.js";

type CandidateRow = {
  source_key: string;
  source_record_id: string;
  product_name: string;
  evidence_tier: "catalog_only" | "nutrition_ready" | "ingredients_ready" | "review_ready";
  image_urls: unknown;
  ingredients_raw: string | null;
  nutrition_analysis_eligible: boolean;
  scan_count: string | number;
  submission_count: string | number;
  updated_at: Date | string;
};

const writeQueue = process.argv.slice(2).includes("--write-queue");
const limitArg = process.argv.slice(2).find(arg => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 100;
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be between 1 and 1000");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to inspect catalog demand");

const { pool } = await import("@workspace/db");
try {
  const rows = await pool.query<CandidateRow>(`
    select
      c.source_key,
      c.source_record_id,
      c.product_name,
      c.evidence_tier,
      c.image_urls,
      c.ingredients_raw,
      c.nutrition_analysis_eligible,
      c.updated_at,
      (select count(*) from scan_events s where s.barcode = c.gtin) as scan_count,
      (select count(*) from product_submissions p
        where (c.gtin is not null and p.barcode = c.gtin)
           or lower(p.product_name) = lower(c.product_name)) as submission_count
    from catalog_import_candidates c
    where c.verification_status in ('imported_unverified', 'pending_review')
      and c.ai_enrichment_status not in ('processing', 'complete')
    order by c.updated_at desc
    limit 10000
  `);

  const now = Date.now();
  const ranked = rows.rows.map(row => {
    const images = Array.isArray(row.image_urls) ? row.image_urls : [];
    const priority = calculateCatalogPriority({
      evidenceTier: row.evidence_tier,
      scanCount: Number(row.scan_count ?? 0),
      submissionCount: Number(row.submission_count ?? 0),
      imageCount: images.length,
      hasNutrition: row.nutrition_analysis_eligible,
      hasIngredients: Boolean(row.ingredients_raw?.trim()),
      daysSinceUpdate: Math.max(0, Math.floor((now - new Date(row.updated_at).getTime()) / 86_400_000)),
    });
    return {
      sourceKey: row.source_key,
      sourceRecordId: row.source_record_id,
      productName: row.product_name,
      ...priority,
    };
  }).sort((a, b) => b.score - a.score).slice(0, limit);

  let queued = 0;
  if (writeQueue) {
    const aiTargets = ranked.filter(item => item.lane === "ai_extract");
    for (let offset = 0; offset < aiTargets.length; offset += 250) {
      const batch = aiTargets.slice(offset, offset + 250);
      const write = await pool.query(`
        update catalog_import_candidates c
        set ai_enrichment_status = 'queued', updated_at = now()
        from jsonb_to_recordset($1::jsonb) as x(source_key text, source_record_id text)
        where c.source_key = x.source_key
          and c.source_record_id = x.source_record_id
          and c.verification_status in ('imported_unverified', 'pending_review')
          and c.ai_enrichment_status in ('not_queued', 'failed')
      `, [JSON.stringify(batch.map(item => ({ source_key: item.sourceKey, source_record_id: item.sourceRecordId })))]);
      queued += write.rowCount ?? 0;
    }
  }

  process.stdout.write(`${JSON.stringify({
    mode: writeQueue ? "write_queue" : "dry_run",
    inspected: rows.rows.length,
    returned: ranked.length,
    queuedForAi: queued,
    lanes: ranked.reduce<Record<string, number>>((counts, item) => {
      counts[item.lane] = (counts[item.lane] ?? 0) + 1;
      return counts;
    }, {}),
    topCandidates: ranked,
    safetyRule: "This job only prioritizes staging work. It never promotes a product or issues a positive buy recommendation.",
  }, null, 2)}\n`);
} finally {
  await pool.end();
}
