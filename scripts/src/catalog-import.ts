import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  TFDA_188_LICENSE,
  TFDA_188_SOURCE_KEY,
  TFDA_188_SOURCE_URL,
  summarizeTfdaCandidates,
  transformTfda188Record,
  type CatalogImportCandidate,
  type Tfda188Record,
} from "./catalog/tfda188.js";

const execFileAsync = promisify(execFile);

type CliOptions = {
  writeStaging: boolean;
  inputJson: string | null;
  limit: number | null;
};

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = { writeStaging: false, inputJson: null, limit: null };
  for (const arg of argv) {
    if (arg === "--write-staging") options.writeStaging = true;
    else if (arg.startsWith("--input-json=")) options.inputJson = arg.slice("--input-json=".length);
    else if (arg.startsWith("--limit=")) {
      const limit = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer");
      options.limit = limit;
    } else if (arg !== "--dry-run") {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function hash(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchTfdaRecords(): Promise<{ records: Tfda188Record[]; payloadSha256: string }> {
  const response = await fetch(TFDA_188_SOURCE_URL, {
    headers: { "User-Agent": "FACTA catalog importer/1.0 (source-backed staging only)" },
  });
  if (!response.ok) throw new Error(`TFDA download failed: HTTP ${response.status}`);

  const archive = new Uint8Array(await response.arrayBuffer());
  const workDir = await mkdtemp(join(tmpdir(), "facta-tfda188-"));
  const archivePath = join(workDir, "tfda188.zip");
  try {
    await writeFile(archivePath, archive);
    const { stdout } = await execFileAsync("unzip", ["-p", archivePath], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) throw new Error("TFDA payload was not a JSON array");
    return { records: parsed as Tfda188Record[], payloadSha256: hash(archive) };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function loadRecordsFromFile(path: string): Promise<{ records: Tfda188Record[]; payloadSha256: string }> {
  const bytes = await readFile(path);
  const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Input file must contain a JSON array");
  return { records: parsed as Tfda188Record[], payloadSha256: hash(bytes) };
}

function prepareCandidates(records: Tfda188Record[]) {
  const candidates: CatalogImportCandidate[] = [];
  const rejected: Array<{ sourceRecordId: string | null; error: string }> = [];
  for (const record of records) {
    try {
      candidates.push(transformTfda188Record(record));
    } catch (error) {
      rejected.push({
        sourceRecordId: record["產品追溯系統串接碼"]?.trim() || null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { candidates, rejected };
}

function dbRecord(candidate: CatalogImportCandidate) {
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

async function writeToStaging(
  candidates: CatalogImportCandidate[],
  payloadSha256: string,
  rejectedCount: number,
  evidenceCounts: Record<string, number>,
): Promise<{ importRunId: number; upsertedCount: number }> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required with --write-staging");
  }

  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  let importRunId: number | null = null;
  try {
    const previous = await client.query<{ fetched_count: number }>(`
      select fetched_count
      from catalog_import_runs
      where source_key = $1 and status = 'completed'
      order by finished_at desc
      limit 1
    `, [TFDA_188_SOURCE_KEY]);
    const previousCount = Number(previous.rows[0]?.fetched_count ?? 0);
    const currentCount = candidates.length + rejectedCount;
    if (
      previousCount > 0
      && currentCount < previousCount * 0.8
      && process.env.FACTA_IMPORT_ALLOW_LARGE_DROP !== "1"
    ) {
      throw new Error(`Import blocked: source row count dropped from ${previousCount} to ${currentCount} (>20%)`);
    }

    await client.query("begin");
    const runResult = await client.query<{ id: string }>(`
      insert into catalog_import_runs (
        source_key, source_url, source_license, status, payload_sha256,
        fetched_count, accepted_count, rejected_count, evidence_counts
      ) values ($1, $2, $3, 'running', $4, $5, $6, $7, $8::jsonb)
      returning id
    `, [
      TFDA_188_SOURCE_KEY,
      TFDA_188_SOURCE_URL,
      TFDA_188_LICENSE,
      payloadSha256,
      candidates.length + rejectedCount,
      candidates.length,
      rejectedCount,
      JSON.stringify(evidenceCounts),
    ]);
    importRunId = Number(runResult.rows[0].id);

    let upsertedCount = 0;
    const batchSize = 250;
    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize).map(dbRecord);
      const result = await client.query(`
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
          x.nutrition_analysis_eligible, x.positive_buy_eligible,
          x.verification_status, x.ai_enrichment_status, x.quality_flags,
          x.raw_payload, now(), now(), now()
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
          traceability_code = excluded.traceability_code,
          image_urls = excluded.image_urls,
          ingredients_raw = excluded.ingredients_raw,
          nutrition_raw = excluded.nutrition_raw,
          evidence_tier = excluded.evidence_tier,
          nutrition_analysis_eligible = excluded.nutrition_analysis_eligible,
          quality_flags = excluded.quality_flags,
          raw_payload = excluded.raw_payload,
          ai_enrichment_status = case
            when catalog_import_candidates.ai_enrichment_status = 'not_queued'
              then excluded.ai_enrichment_status
            else catalog_import_candidates.ai_enrichment_status
          end,
          last_seen_at = now(),
          updated_at = now()
      `, [importRunId, JSON.stringify(batch)]);
      upsertedCount += result.rowCount ?? 0;
    }

    await client.query(`
      update catalog_import_runs
      set status = 'completed', finished_at = now()
      where id = $1
    `, [importRunId]);
    await client.query("commit");
    return { importRunId, upsertedCount };
  } catch (error) {
    await client.query("rollback");
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
  const loaded = options.inputJson
    ? await loadRecordsFromFile(options.inputJson)
    : await fetchTfdaRecords();
  const selected = options.limit ? loaded.records.slice(0, options.limit) : loaded.records;
  const { candidates, rejected } = prepareCandidates(selected);
  const summary = summarizeTfdaCandidates(candidates);
  const result: Record<string, unknown> = {
    mode: options.writeStaging ? "write_staging" : "dry_run",
    source: TFDA_188_SOURCE_KEY,
    sourceUrl: TFDA_188_SOURCE_URL,
    sourceLicense: TFDA_188_LICENSE,
    payloadSha256: loaded.payloadSha256,
    rawFetchedCount: selected.length,
    rejectedCount: rejected.length,
    rejectedSample: rejected.slice(0, 5),
    ...summary,
  };

  if (options.writeStaging) {
    if (rejected.length > 0) {
      throw new Error(`Import blocked: ${rejected.length} source record(s) are missing required identity fields`);
    }
    if (summary.uniqueSourceRecords !== candidates.length) {
      throw new Error("Import blocked: duplicate source record IDs detected");
    }
    result.database = await writeToStaging(
      candidates,
      loaded.payloadSha256,
      rejected.length,
      summary.evidenceCounts,
    );
  } else {
    result.nextStep = "Run the staging migration, review this audit, then rerun with --write-staging after explicit production approval.";
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

await main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
