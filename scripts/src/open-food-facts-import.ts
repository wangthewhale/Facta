import { createHash } from "node:crypto";
import {
  OFF_LICENSE,
  OFF_SEARCH_URL,
  OFF_SOURCE_KEY,
  summarizeOpenFoodFactsCandidates,
  transformOpenFoodFactsProduct,
  type OpenFoodFactsCandidate,
  type OpenFoodFactsProduct,
} from "./catalog/openFoodFactsCatalog.js";

type Options = {
  writeStaging: boolean;
  country: string;
  startPage: number;
  maxPages: number;
  pageSize: number;
  delayMs: number;
};

type SearchResponse = {
  count?: number;
  page?: number;
  page_count?: number;
  page_size?: number;
  products?: OpenFoodFactsProduct[];
};

function parseOptions(argv: string[]): Options {
  const options: Options = {
    writeStaging: false,
    country: "Taiwan",
    startPage: 1,
    maxPages: 1,
    pageSize: 100,
    delayMs: 6_500,
  };
  for (const arg of argv) {
    if (arg === "--write-staging") options.writeStaging = true;
    else if (arg === "--dry-run") continue;
    else if (arg.startsWith("--country=")) options.country = arg.slice("--country=".length).trim();
    else if (arg.startsWith("--start-page=")) options.startPage = Number(arg.slice("--start-page=".length));
    else if (arg.startsWith("--max-pages=")) options.maxPages = Number(arg.slice("--max-pages=".length));
    else if (arg.startsWith("--page-size=")) options.pageSize = Number(arg.slice("--page-size=".length));
    else if (arg.startsWith("--delay-ms=")) options.delayMs = Number(arg.slice("--delay-ms=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.country) throw new Error("--country must not be empty");
  if (!Number.isInteger(options.startPage) || options.startPage < 1) throw new Error("--start-page must be a positive integer");
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 500) throw new Error("--max-pages must be between 1 and 500");
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 1000) throw new Error("--page-size must be between 1 and 1000");
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) throw new Error("--delay-ms must be non-negative");
  return options;
}

const fields = [
  "code", "product_name", "product_name_zh", "brands", "categories", "quantity",
  "image_front_url", "image_nutrition_url", "image_ingredients_url",
  "ingredients_text", "ingredients_text_zh", "nutrition_data_per", "nutriments",
  "countries_tags", "last_modified_t",
].join(",");

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(options: Options, page: number): Promise<{ payload: SearchResponse; raw: string; url: string }> {
  const url = new URL(OFF_SEARCH_URL);
  url.searchParams.set("countries_tags_en", options.country);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(options.pageSize));
  url.searchParams.set("fields", fields);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": process.env.OPEN_FOOD_FACTS_USER_AGENT ?? "FACTA/1.0 (https://facta.replit.app; source-backed staging importer)",
        },
      });
      if (!response.ok) throw new Error(`Open Food Facts search failed: HTTP ${response.status}`);
      const raw = await response.text();
      const payload = JSON.parse(raw) as SearchResponse;
      if (!Array.isArray(payload.products)) throw new Error("Open Food Facts search response has no products array");
      return { payload, raw, url: url.toString() };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 2_000);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function dbRecord(candidate: OpenFoodFactsCandidate) {
  return {
    source_key: candidate.sourceKey,
    source_record_id: candidate.sourceRecordId,
    source_url: candidate.sourceUrl,
    source_license: candidate.sourceLicense,
    payload_sha256: candidate.payloadSha256,
    canonical_key: candidate.canonicalKey,
    product_name: candidate.productName,
    brand_name: candidate.brandName,
    category_name: candidate.categoryName,
    package_spec: candidate.packageSpec,
    gtin: candidate.gtin,
    traceability_code: candidate.traceabilityCode,
    image_urls: candidate.imageUrls,
    ingredients_raw: candidate.ingredientsRaw,
    nutrition_raw: candidate.nutritionRaw,
    evidence_tier: candidate.evidenceTier,
    nutrition_analysis_eligible: candidate.nutritionAnalysisEligible,
    positive_buy_eligible: candidate.positiveBuyEligible,
    verification_status: candidate.verificationStatus,
    ai_enrichment_status: candidate.aiEnrichmentStatus,
    quality_flags: candidate.qualityFlags,
    raw_payload: candidate.rawPayload,
  };
}

async function writeToStaging(input: {
  candidates: OpenFoodFactsCandidate[];
  payloadSha256: string;
  rejectedCount: number;
  sourceUrl: string;
}) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required with --write-staging");
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  let importRunId: number | null = null;
  try {
    const evidenceCounts = input.candidates.reduce<Record<string, number>>((counts, candidate) => {
      counts[candidate.evidenceTier] = (counts[candidate.evidenceTier] ?? 0) + 1;
      return counts;
    }, {});
    const run = await client.query<{ id: string }>(`
      insert into catalog_import_runs (
        source_key, source_url, source_license, status, payload_sha256,
        fetched_count, accepted_count, rejected_count, evidence_counts
      ) values ($1, $2, $3, 'running', $4, $5, $6, $7, $8::jsonb)
      returning id
    `, [
      OFF_SOURCE_KEY,
      input.sourceUrl,
      OFF_LICENSE,
      input.payloadSha256,
      input.candidates.length + input.rejectedCount,
      input.candidates.length,
      input.rejectedCount,
      JSON.stringify(evidenceCounts),
    ]);
    importRunId = Number(run.rows[0]?.id);

    let upsertedCount = 0;
    for (let offset = 0; offset < input.candidates.length; offset += 250) {
      const batch = input.candidates.slice(offset, offset + 250).map(dbRecord);
      const write = await client.query(`
        insert into catalog_import_candidates (
          import_run_id, source_key, source_record_id, source_url, source_license,
          payload_sha256, canonical_key, product_name, brand_name, category_name,
          package_spec, gtin, traceability_code, image_urls, ingredients_raw,
          nutrition_raw, evidence_tier, nutrition_analysis_eligible,
          positive_buy_eligible, verification_status, ai_enrichment_status,
          quality_flags, raw_payload, first_seen_at, last_seen_at, updated_at
        )
        select
          $1, x.source_key, x.source_record_id, x.source_url, x.source_license,
          x.payload_sha256, x.canonical_key, x.product_name, x.brand_name,
          x.category_name, x.package_spec, x.gtin, x.traceability_code,
          x.image_urls, x.ingredients_raw, x.nutrition_raw, x.evidence_tier,
          x.nutrition_analysis_eligible, false, 'imported_unverified',
          x.ai_enrichment_status, x.quality_flags, x.raw_payload,
          now(), now(), now()
        from jsonb_to_recordset($2::jsonb) as x(
          source_key text, source_record_id text, source_url text,
          source_license text, payload_sha256 text, canonical_key text,
          product_name text, brand_name text, category_name text,
          package_spec text, gtin text, traceability_code text,
          image_urls jsonb, ingredients_raw text, nutrition_raw jsonb,
          evidence_tier text, nutrition_analysis_eligible boolean,
          positive_buy_eligible boolean, verification_status text,
          ai_enrichment_status text, quality_flags jsonb, raw_payload jsonb
        )
        on conflict (source_key, source_record_id) do update set
          import_run_id = excluded.import_run_id,
          source_url = excluded.source_url,
          source_license = excluded.source_license,
          payload_sha256 = excluded.payload_sha256,
          canonical_key = excluded.canonical_key,
          product_name = excluded.product_name,
          brand_name = excluded.brand_name,
          category_name = excluded.category_name,
          package_spec = excluded.package_spec,
          gtin = excluded.gtin,
          image_urls = excluded.image_urls,
          ingredients_raw = excluded.ingredients_raw,
          nutrition_raw = excluded.nutrition_raw,
          evidence_tier = excluded.evidence_tier,
          nutrition_analysis_eligible = excluded.nutrition_analysis_eligible,
          positive_buy_eligible = false,
          verification_status = case
            when catalog_import_candidates.verification_status in ('promoted', 'rejected')
              then catalog_import_candidates.verification_status
            else 'imported_unverified'
          end,
          ai_enrichment_status = case
            when catalog_import_candidates.ai_enrichment_status in ('complete', 'failed')
              then catalog_import_candidates.ai_enrichment_status
            else excluded.ai_enrichment_status
          end,
          quality_flags = excluded.quality_flags,
          raw_payload = excluded.raw_payload,
          last_seen_at = now(),
          updated_at = now()
      `, [importRunId, JSON.stringify(batch)]);
      upsertedCount += write.rowCount ?? 0;
    }

    await client.query(`update catalog_import_runs set status = 'completed', finished_at = now() where id = $1`, [importRunId]);
    return { importRunId, upsertedCount };
  } catch (error) {
    if (importRunId != null) {
      await pool.query(`
        update catalog_import_runs
        set status = 'failed', error_message = $2, finished_at = now()
        where id = $1
      `, [importRunId, error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)]).catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const candidates: OpenFoodFactsCandidate[] = [];
  const rejected: Array<{ code: string | null; error: string }> = [];
  const hashes: string[] = [];
  let sourceTotal: number | null = null;
  let sourceUrl = OFF_SEARCH_URL;
  let pagesFetched = 0;

  for (let offset = 0; offset < options.maxPages; offset += 1) {
    const page = options.startPage + offset;
    const fetched = await fetchPage(options, page);
    pagesFetched += 1;
    sourceUrl = fetched.url;
    sourceTotal = typeof fetched.payload.count === "number" ? fetched.payload.count : sourceTotal;
    hashes.push(createHash("sha256").update(fetched.raw).digest("hex"));
    for (const product of fetched.payload.products ?? []) {
      try {
        candidates.push(transformOpenFoodFactsProduct(product));
      } catch (error) {
        rejected.push({
          code: typeof product.code === "string" ? product.code : null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if ((fetched.payload.products?.length ?? 0) < options.pageSize) break;
    if (offset < options.maxPages - 1 && options.delayMs > 0) await sleep(options.delayMs);
  }

  const unique = new Map(candidates.map(candidate => [candidate.gtin, candidate]));
  const deduped = [...unique.values()];
  const payloadSha256 = createHash("sha256").update(hashes.join("|"), "utf8").digest("hex");
  const output: Record<string, unknown> = {
    mode: options.writeStaging ? "write_staging" : "dry_run",
    source: OFF_SOURCE_KEY,
    sourceLicense: OFF_LICENSE,
    country: options.country,
    sourceReportedCount: sourceTotal,
    startPage: options.startPage,
    pagesFetched,
    pageSize: options.pageSize,
    fetchedRows: candidates.length + rejected.length,
    rejected: rejected.length,
    rejectedSample: rejected.slice(0, 5),
    payloadSha256,
    ...summarizeOpenFoodFactsCandidates(deduped),
    safetyRule: "Open Food Facts rows remain unverified staging candidates and can never receive a positive buy recommendation automatically.",
  };

  if (options.writeStaging) {
    output.database = await writeToStaging({
      candidates: deduped,
      payloadSha256,
      rejectedCount: rejected.length,
      sourceUrl,
    });
  } else {
    output.nextStep = "Review this audit, then run with --write-staging only after production approval. Use --start-page to resume safely.";
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

await main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
