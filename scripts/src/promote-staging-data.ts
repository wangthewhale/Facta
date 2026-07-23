import { pathToFileURL } from "node:url";
import { pool as developmentPool } from "@workspace/db";

const CATALOG_SOURCES = ["7eleven_tw_freshfoods", "open_food_facts"] as const;
const BATCH_SIZE = 200;

type Row = Record<string, unknown>;
type SqlClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }>;
  release?: () => void;
};

type Options = { writeProduction: boolean };

function parseOptions(argv: string[]): Options {
  const options = { writeProduction: false };
  for (const arg of argv) {
    if (arg === "--write-production") options.writeProduction = true;
    else if (arg === "--dry-run") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireProductionUrl(): string {
  const value = process.env.PRODUCTION_DATABASE_URL?.trim();
  if (!value) throw new Error("PRODUCTION_DATABASE_URL is required");
  if (value === process.env.DATABASE_URL) {
    throw new Error("Production and development database URLs must be different");
  }
  return value;
}

function placeholders(rowCount: number, columns: string[], jsonColumns: Set<string>): string {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const start = rowIndex * columns.length;
    return `(${columns.map((column, columnIndex) => {
      const parameter = `$${start + columnIndex + 1}`;
      return jsonColumns.has(column) ? `${parameter}::jsonb` : parameter;
    }).join(",")})`;
  }).join(",");
}

async function insertBatches(input: {
  client: SqlClient;
  table: string;
  columns: string[];
  rows: Row[];
  conflict: string;
  label: string;
  jsonColumns?: string[];
}): Promise<void> {
  const jsonColumns = new Set(input.jsonColumns ?? []);
  for (let offset = 0; offset < input.rows.length; offset += BATCH_SIZE) {
    const batch = input.rows.slice(offset, offset + BATCH_SIZE);
    const values = batch.flatMap(row => input.columns.map(column => {
      const value = row[column] ?? null;
      return value !== null && jsonColumns.has(column) ? JSON.stringify(value) : value;
    }));
    await input.client.query(
      `insert into ${input.table} (${input.columns.join(",")}) values ${placeholders(batch.length, input.columns, jsonColumns)} ${input.conflict}`,
      values,
    );
    if (offset === 0 || offset + batch.length === input.rows.length || (offset + batch.length) % 5_000 === 0) {
      process.stderr.write(`${input.label}=${offset + batch.length}/${input.rows.length}\n`);
    }
  }
}

function sourceKey(row: Row): string {
  return `${String(row.provider)}\u0000${String(row.external_id)}`;
}

async function loadSummary(client: SqlClient) {
  const catalog = await client.query(
    `select source_key, count(*)::int as count
       from catalog_import_candidates
      where source_key = any($1::text[])
      group by source_key
      order by source_key`,
    [[...CATALOG_SOURCES]],
  );
  const science = await client.query(`
    select
      (select count(*)::int from scientific_evidence_sources) as sources,
      (select count(*)::int from scientific_evidence_topic_links) as links,
      (select count(*)::int from scientific_evidence_claims) as claims,
      (select count(*)::int from scientific_evidence_topic_links where consumer_use_status = 'eligible') as eligible,
      (select count(*)::int
         from scientific_evidence_topic_links l
         join scientific_evidence_sources s on s.id = l.source_id
        where s.integrity_status in ('retracted', 'expression_of_concern')
          and l.consumer_use_status <> 'excluded') as unsafe_not_excluded
  `);
  return { catalog: catalog.rows, science: science.rows[0] };
}

async function promoteCatalog(client: SqlClient): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const candidateColumns = [
    "import_run_id", "source_key", "source_record_id", "source_url", "source_license",
    "source_updated_at", "payload_sha256", "canonical_key", "product_name", "brand_name",
    "category_name", "package_spec", "gtin", "traceability_code", "image_urls",
    "ingredients_raw", "nutrition_raw", "evidence_tier", "nutrition_analysis_eligible",
    "positive_buy_eligible", "verification_status", "ai_enrichment_status", "quality_flags",
    "raw_payload", "first_seen_at", "last_seen_at", "promoted_product_id", "reviewed_at",
    "reviewed_by", "created_at", "updated_at",
  ];

  for (const source of CATALOG_SOURCES) {
    const sourceRows = await developmentPool.query(
      `select ${candidateColumns.filter(column => column !== "import_run_id").join(",")}
         from catalog_import_candidates
        where source_key = $1
        order by source_record_id`,
      [source],
    );
    if (sourceRows.rows.length === 0) throw new Error(`No development candidates found for ${source}`);
    const first = sourceRows.rows[0] as Row;
    const run = await client.query(
      `insert into catalog_import_runs (
         source_key, source_url, source_license, status, payload_sha256,
         fetched_count, accepted_count, rejected_count, evidence_counts, finished_at
       ) values ($1,$2,$3,'completed',null,$4,$4,0,$5::jsonb,now()) returning id`,
      [
        source,
        first.source_url,
        first.source_license,
        sourceRows.rows.length,
        JSON.stringify({ promotedFromDevelopment: true, positiveBuyEligible: 0 }),
      ],
    );
    const runId = run.rows[0]?.id;
    const rows = sourceRows.rows.map(row => ({ ...row, import_run_id: runId, positive_buy_eligible: false }));
    await insertBatches({
      client,
      table: "catalog_import_candidates",
      columns: candidateColumns,
      rows,
      label: `catalog:${source}`,
      jsonColumns: ["image_urls", "nutrition_raw", "quality_flags", "raw_payload"],
      conflict: `on conflict (source_key, source_record_id) do update set
        import_run_id = excluded.import_run_id,
        source_url = excluded.source_url,
        source_license = excluded.source_license,
        source_updated_at = excluded.source_updated_at,
        payload_sha256 = excluded.payload_sha256,
        canonical_key = excluded.canonical_key,
        product_name = excluded.product_name,
        brand_name = excluded.brand_name,
        category_name = excluded.category_name,
        package_spec = excluded.package_spec,
        gtin = excluded.gtin,
        traceability_code = excluded.traceability_code,
        image_urls = excluded.image_urls,
        ingredients_raw = excluded.ingredients_raw,
        nutrition_raw = excluded.nutrition_raw,
        evidence_tier = excluded.evidence_tier,
        nutrition_analysis_eligible = excluded.nutrition_analysis_eligible,
        positive_buy_eligible = false,
        ai_enrichment_status = excluded.ai_enrichment_status,
        quality_flags = excluded.quality_flags,
        raw_payload = excluded.raw_payload,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
      where catalog_import_candidates.verification_status in ('imported_unverified', 'pending_review')`,
    });
    result[source] = rows.length;
  }
  return result;
}

async function promoteScience(client: SqlClient): Promise<{ sources: number; links: number; claims: number }> {
  const topicColumns = [
    "canonical_name", "display_name_zh", "topic_type", "aliases", "query_terms",
    "is_active", "last_synced_at", "created_at", "updated_at",
  ];
  const topics = await developmentPool.query(`select ${topicColumns.join(",")} from scientific_evidence_topics order by id`);
  await insertBatches({
    client,
    table: "scientific_evidence_topics",
    columns: topicColumns,
    rows: topics.rows,
    label: "science:topics",
    jsonColumns: ["aliases", "query_terms"],
    conflict: `on conflict (canonical_name) do update set
      display_name_zh = excluded.display_name_zh,
      topic_type = excluded.topic_type,
      aliases = excluded.aliases,
      query_terms = excluded.query_terms,
      is_active = excluded.is_active,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at`,
  });
  const targetTopics = await client.query(`select id, canonical_name from scientific_evidence_topics`);
  const topicIds = new Map(targetTopics.rows.map(row => [String(row.canonical_name), row.id]));

  const sourceRuns = await developmentPool.query(`
    select r.*, t.canonical_name as topic_name
      from scientific_evidence_sync_runs r
      left join scientific_evidence_topics t on t.id = r.topic_id
     order by r.id
  `);
  const runIds = new Map<string, unknown>();
  for (const row of sourceRuns.rows) {
    const topicId = row.topic_name == null ? null : topicIds.get(String(row.topic_name));
    const existing = await client.query(
      `select id from scientific_evidence_sync_runs
        where provider = $1
          and topic_id is not distinct from $2
          and query_text is not distinct from $3
          and range_start = $4
          and range_end = $5
          and started_at = $6
        limit 1`,
      [row.provider, topicId, row.query_text, row.range_start, row.range_end, row.started_at],
    );
    const targetRun = existing.rows[0] ?? (await client.query(
      `insert into scientific_evidence_sync_runs (
        provider, topic_id, query_text, range_start, range_end, cursor_start, cursor_end,
        status, fetched_count, accepted_count, rejected_count, duplicate_count,
        integrity_excluded_count, licensed_full_text_count, quality_summary, error_message,
        started_at, finished_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18) returning id`,
      [
        row.provider, topicId, row.query_text, row.range_start, row.range_end,
        row.cursor_start, row.cursor_end, row.status, row.fetched_count, row.accepted_count,
        row.rejected_count, row.duplicate_count, row.integrity_excluded_count,
        row.licensed_full_text_count, JSON.stringify(row.quality_summary ?? {}), row.error_message,
        row.started_at, row.finished_at,
      ],
    )).rows[0];
    runIds.set(String(row.id), targetRun?.id);
  }

  const sourceColumns = [
    "last_sync_run_id", "provider", "external_id", "pmid", "pmcid", "doi", "title",
    "abstract_text", "abstract_sha256", "full_text_text", "full_text_sha256", "journal",
    "publication_date", "publication_year", "publication_types", "mesh_terms", "authors",
    "source_url", "is_open_access", "license_id", "content_reuse_status", "study_design",
    "study_design_rank", "integrity_status", "integrity_checked_at", "quality_flags",
    "raw_metadata", "retrieved_at", "created_at", "updated_at",
  ];
  const sources = await developmentPool.query(`select id as development_id, ${sourceColumns.join(",")} from scientific_evidence_sources order by id`);
  const sourceRows = sources.rows.map(row => ({
    ...row,
    last_sync_run_id: row.last_sync_run_id == null ? null : runIds.get(String(row.last_sync_run_id)) ?? null,
  }));
  await insertBatches({
    client,
    table: "scientific_evidence_sources",
    columns: sourceColumns,
    rows: sourceRows,
    label: "science:sources",
    jsonColumns: ["publication_types", "mesh_terms", "authors", "quality_flags", "raw_metadata"],
    conflict: `on conflict (provider, external_id) do update set
      last_sync_run_id = excluded.last_sync_run_id,
      pmid = excluded.pmid,
      pmcid = excluded.pmcid,
      doi = excluded.doi,
      title = excluded.title,
      abstract_text = excluded.abstract_text,
      abstract_sha256 = excluded.abstract_sha256,
      full_text_text = excluded.full_text_text,
      full_text_sha256 = excluded.full_text_sha256,
      journal = excluded.journal,
      publication_date = excluded.publication_date,
      publication_year = excluded.publication_year,
      publication_types = excluded.publication_types,
      mesh_terms = excluded.mesh_terms,
      authors = excluded.authors,
      source_url = excluded.source_url,
      is_open_access = excluded.is_open_access,
      license_id = excluded.license_id,
      content_reuse_status = excluded.content_reuse_status,
      study_design = excluded.study_design,
      study_design_rank = excluded.study_design_rank,
      integrity_status = excluded.integrity_status,
      integrity_checked_at = excluded.integrity_checked_at,
      quality_flags = excluded.quality_flags,
      raw_metadata = excluded.raw_metadata,
      retrieved_at = excluded.retrieved_at,
      updated_at = excluded.updated_at`,
  });
  const targetSources = await client.query(`select id, provider, external_id from scientific_evidence_sources`);
  const targetSourceIds = new Map(targetSources.rows.map(row => [sourceKey(row), row.id]));

  const links = await developmentPool.query(`
    select s.provider, s.external_id, t.canonical_name as topic_name, l.sync_run_id,
      l.matched_terms, l.relevance_method, l.relevance_score, l.consumer_use_status,
      l.review_status, l.reviewed_at, l.reviewed_by, l.quality_flags, l.created_at, l.updated_at
    from scientific_evidence_topic_links l
    join scientific_evidence_sources s on s.id = l.source_id
    join scientific_evidence_topics t on t.id = l.topic_id
    order by l.id
  `);
  const linkColumns = [
    "source_id", "topic_id", "sync_run_id", "matched_terms", "relevance_method",
    "relevance_score", "consumer_use_status", "review_status", "reviewed_at", "reviewed_by",
    "quality_flags", "created_at", "updated_at",
  ];
  const linkRows = links.rows.map(row => ({
    ...row,
    source_id: targetSourceIds.get(sourceKey(row)),
    topic_id: topicIds.get(String(row.topic_name)),
    sync_run_id: row.sync_run_id == null ? null : runIds.get(String(row.sync_run_id)) ?? null,
    consumer_use_status: row.consumer_use_status === "eligible" && row.review_status !== "reviewed"
      ? "pending_review"
      : row.consumer_use_status,
  }));
  if (linkRows.some(row => row.source_id == null || row.topic_id == null)) {
    throw new Error("Scientific link mapping is incomplete");
  }
  await insertBatches({
    client,
    table: "scientific_evidence_topic_links",
    columns: linkColumns,
    rows: linkRows,
    label: "science:links",
    jsonColumns: ["matched_terms", "quality_flags"],
    conflict: `on conflict (source_id, topic_id) do update set
      sync_run_id = excluded.sync_run_id,
      matched_terms = excluded.matched_terms,
      relevance_method = excluded.relevance_method,
      relevance_score = excluded.relevance_score,
      consumer_use_status = excluded.consumer_use_status,
      review_status = excluded.review_status,
      reviewed_at = excluded.reviewed_at,
      reviewed_by = excluded.reviewed_by,
      quality_flags = excluded.quality_flags,
      updated_at = excluded.updated_at`,
  });

  const claims = await developmentPool.query(`
    select s.provider, s.external_id, t.canonical_name as topic_name,
      c.population_text, c.exposure_text, c.comparator_text, c.outcome_text, c.direction,
      c.effect_estimate, c.limitations, c.extraction_status, c.body_certainty,
      c.consumer_summary_zh, c.source_quote_locator, c.reviewed_at, c.reviewed_by,
      c.created_at, c.updated_at
    from scientific_evidence_claims c
    join scientific_evidence_sources s on s.id = c.source_id
    join scientific_evidence_topics t on t.id = c.topic_id
    order by c.id
  `);
  if (claims.rows.length > 0) {
    const existingClaims = await client.query(`select count(*)::int as count from scientific_evidence_claims`);
    if (Number(existingClaims.rows[0]?.count ?? 0) > 0) {
      throw new Error("Production scientific claims are not empty; automatic claim merging is intentionally blocked");
    }
    const claimColumns = [
      "source_id", "topic_id", "population_text", "exposure_text", "comparator_text",
      "outcome_text", "direction", "effect_estimate", "limitations", "extraction_status",
      "body_certainty", "consumer_summary_zh", "source_quote_locator", "reviewed_at",
      "reviewed_by", "created_at", "updated_at",
    ];
    const claimRows = claims.rows.map(row => ({
      ...row,
      source_id: targetSourceIds.get(sourceKey(row)),
      topic_id: topicIds.get(String(row.topic_name)),
    }));
    await insertBatches({
      client,
      table: "scientific_evidence_claims",
      columns: claimColumns,
      rows: claimRows,
      label: "science:claims",
      jsonColumns: ["effect_estimate", "limitations"],
      conflict: "",
    });
  }

  await client.query(`
    update scientific_evidence_topic_links l
       set consumer_use_status = 'excluded', updated_at = now()
      from scientific_evidence_sources s
     where s.id = l.source_id
       and s.integrity_status in ('retracted', 'expression_of_concern')
  `);
  await client.query(`
    update scientific_evidence_topic_links
       set consumer_use_status = 'pending_review', updated_at = now()
     where consumer_use_status = 'eligible' and review_status <> 'reviewed'
  `);
  return { sources: sourceRows.length, links: linkRows.length, claims: claims.rows.length };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const productionUrl = requireProductionUrl();
  const PoolConstructor = developmentPool.constructor as unknown as new (options: { connectionString: string; max: number }) => typeof developmentPool;
  const productionPool = new PoolConstructor({ connectionString: productionUrl, max: 3 });
  try {
    const sourceSummary = await loadSummary(developmentPool as unknown as SqlClient);
    const productionBefore = await loadSummary(productionPool as unknown as SqlClient);
    if (!options.writeProduction) {
      process.stdout.write(`${JSON.stringify({ mode: "dry_run", source: sourceSummary, productionBefore }, null, 2)}\n`);
      return;
    }

    const client = await productionPool.connect() as unknown as SqlClient;
    try {
      await client.query("begin");
      const catalog = await promoteCatalog(client);
      const science = await promoteScience(client);
      const productionAfter = await loadSummary(client);
      const unsafe = Number(productionAfter.science?.unsafe_not_excluded ?? 0);
      const eligible = Number(productionAfter.science?.eligible ?? 0);
      const positive = await client.query(
        `select count(*)::int as count from catalog_import_candidates
          where source_key = any($1::text[]) and positive_buy_eligible = true`,
        [[...CATALOG_SOURCES]],
      );
      if (unsafe !== 0 || eligible !== 0 || Number(positive.rows[0]?.count ?? 0) !== 0) {
        throw new Error("Production safety invariant failed; rolling back");
      }
      await client.query("commit");
      process.stdout.write(`${JSON.stringify({
        mode: "write_production",
        catalog,
        science,
        productionAfter,
        safety: { positiveBuyEligible: 0, consumerEligible: eligible, unsafeIntegrityNotExcluded: unsafe },
      }, null, 2)}\n`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release?.();
    }
  } finally {
    await productionPool.end();
    await developmentPool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
