import { createHash } from "node:crypto";
import {
  parseSevenElevenCatalogXml,
  SEVEN_ELEVEN_CATEGORIES,
  SEVEN_ELEVEN_SOURCE_KEY,
  SEVEN_ELEVEN_SOURCE_LICENSE,
  SEVEN_ELEVEN_XML_BASE,
  summarizeSevenElevenCatalog,
  type SevenElevenCatalogCandidate,
} from "./catalog/sevenElevenTaiwan.js";

type Options = { writeStaging: boolean; maxCategories: number; delayMs: number };

function options(argv: string[]): Options {
  const parsed: Options = { writeStaging: false, maxCategories: SEVEN_ELEVEN_CATEGORIES.length, delayMs: 150 };
  for (const arg of argv) {
    if (arg === "--write-staging") parsed.writeStaging = true;
    else if (arg === "--dry-run") continue;
    else if (arg.startsWith("--max-categories=")) parsed.maxCategories = Number(arg.slice(17));
    else if (arg.startsWith("--delay-ms=")) parsed.delayMs = Number(arg.slice(11));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(parsed.maxCategories) || parsed.maxCategories < 1 || parsed.maxCategories > SEVEN_ELEVEN_CATEGORIES.length) {
    throw new Error(`--max-categories must be between 1 and ${SEVEN_ELEVEN_CATEGORIES.length}`);
  }
  if (!Number.isFinite(parsed.delayMs) || parsed.delayMs < 0) throw new Error("--delay-ms must be non-negative");
  return parsed;
}

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchCategory(index: number): Promise<{ candidates: SevenElevenCatalogCandidate[]; sha256: string }> {
  const url = `${SEVEN_ELEVEN_XML_BASE}?=${index}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "FACTA/1.0 (https://facta.replit.app; 7-ELEVEN catalog indexer)" },
    });
    if (!response.ok) throw new Error(`7-ELEVEN category ${index} failed: HTTP ${response.status}`);
    const xml = await response.text();
    if (!/<BD(?:\s|\/?>)/i.test(xml)) throw new Error(`7-ELEVEN category ${index} returned no catalog XML`);
    return {
      candidates: parseSevenElevenCatalogXml(xml, index),
      sha256: createHash("sha256").update(xml).digest("hex"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeStaging(candidates: SevenElevenCatalogCandidate[], payloadSha256: string) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required with --write-staging");
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  let runId: number | null = null;
  try {
    await client.query("begin");
    const run = await client.query<{ id: string }>(`
      insert into catalog_import_runs (
        source_key, source_url, source_license, status, payload_sha256,
        fetched_count, accepted_count, rejected_count, evidence_counts
      ) values ($1, $2, $3, 'running', $4, $5, $5, 0, $6::jsonb)
      returning id
    `, [
      SEVEN_ELEVEN_SOURCE_KEY,
      "https://www.7-11.com.tw/freshfoods/hot.aspx",
      SEVEN_ELEVEN_SOURCE_LICENSE,
      payloadSha256,
      candidates.length,
      JSON.stringify({ catalog_only: candidates.length }),
    ]);
    runId = Number(run.rows[0]?.id);
    for (let offset = 0; offset < candidates.length; offset += 250) {
      const batch = candidates.slice(offset, offset + 250).map(candidate => ({
        source_key: candidate.sourceKey,
        source_record_id: candidate.sourceRecordId,
        source_url: candidate.sourceUrl,
        source_license: candidate.sourceLicense,
        payload_sha256: candidate.payloadSha256,
        canonical_key: candidate.canonicalKey,
        product_name: candidate.productName,
        brand_name: candidate.brandName,
        category_name: candidate.categoryName,
        image_urls: candidate.imageUrls,
        nutrition_raw: candidate.nutritionRaw,
        quality_flags: candidate.qualityFlags,
        raw_payload: candidate.rawPayload,
      }));
      await client.query(`
        insert into catalog_import_candidates (
          import_run_id, source_key, source_record_id, source_url, source_license,
          payload_sha256, canonical_key, product_name, brand_name, category_name,
          gtin, image_urls, ingredients_raw, nutrition_raw, evidence_tier,
          nutrition_analysis_eligible, positive_buy_eligible, verification_status,
          ai_enrichment_status, quality_flags, raw_payload, first_seen_at, last_seen_at, updated_at
        )
        select $1, x.source_key, x.source_record_id, x.source_url, x.source_license,
          x.payload_sha256, x.canonical_key, x.product_name, x.brand_name, x.category_name,
          null, x.image_urls, null, x.nutrition_raw, 'catalog_only', false, false,
          'imported_unverified', 'not_queued', x.quality_flags, x.raw_payload,
          now(), now(), now()
        from jsonb_to_recordset($2::jsonb) as x(
          source_key text, source_record_id text, source_url text, source_license text,
          payload_sha256 text, canonical_key text, product_name text, brand_name text,
          category_name text, image_urls jsonb, nutrition_raw jsonb, quality_flags jsonb,
          raw_payload jsonb
        )
        on conflict (source_key, source_record_id) do update set
          import_run_id = excluded.import_run_id,
          source_url = excluded.source_url,
          payload_sha256 = excluded.payload_sha256,
          canonical_key = excluded.canonical_key,
          product_name = excluded.product_name,
          brand_name = excluded.brand_name,
          category_name = excluded.category_name,
          image_urls = excluded.image_urls,
          nutrition_raw = excluded.nutrition_raw,
          quality_flags = excluded.quality_flags,
          raw_payload = excluded.raw_payload,
          last_seen_at = now(), updated_at = now()
      `, [runId, JSON.stringify(batch)]);
    }
    await client.query("update catalog_import_runs set status = 'completed', finished_at = now() where id = $1", [runId]);
    await client.query("commit");
    return { importRunId: runId, upserted: candidates.length };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const parsed = options(process.argv.slice(2));
  const all: SevenElevenCatalogCandidate[] = [];
  const hashes: string[] = [];
  for (let index = 0; index < parsed.maxCategories; index += 1) {
    // The official app intentionally skips Slurpee (index 10) in this food feed.
    if (index === 10) continue;
    const result = await fetchCategory(index);
    all.push(...result.candidates);
    hashes.push(result.sha256);
    if (parsed.delayMs) await sleep(parsed.delayMs);
  }
  const unique = [...new Map(all.map(candidate => [`${candidate.sourceKey}:${candidate.sourceRecordId}`, candidate])).values()];
  const catalogSummary = summarizeSevenElevenCatalog(unique);
  const summary = {
    source: SEVEN_ELEVEN_SOURCE_KEY,
    mode: parsed.writeStaging ? "write-staging" : "dry-run",
    fetchedCategories: hashes.length,
    ...catalogSummary,
    acceptedRate: all.length ? unique.length / all.length : 0,
    imageCoverageRate: unique.length ? catalogSummary.withImages / unique.length : 0,
    calorieClaimCoverageRate: unique.length ? catalogSummary.withCalories / unique.length : 0,
    priceCoverageRate: unique.length ? catalogSummary.withPrices / unique.length : 0,
  };
  const write = parsed.writeStaging
    ? await writeStaging(unique, createHash("sha256").update(hashes.join("|")).digest("hex"))
    : null;
  process.stdout.write(`${JSON.stringify({ ...summary, write }, null, 2)}\n`);
}

await main();
