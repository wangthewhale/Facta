import {
  attachLicensedFullText,
  buildEuropePmcQuery,
  DEFAULT_EVIDENCE_TOPICS,
  EUROPE_PMC_API,
  normalizeEuropePmcResult,
  type EvidenceTopicDefinition,
  type EuropePmcResult,
  type NormalizedScientificSource,
} from "./science/europePmc.js";

type Options = {
  writeStaging: boolean;
  topics: string[];
  rangeStart: string;
  rangeEnd: string;
  maxPages: number;
  pageSize: number;
  delayMs: number;
  includeOaFullText: boolean;
  includePreclinical: boolean;
  topicsFromDb: boolean;
};

type SearchResponse = {
  hitCount?: number;
  nextCursorMark?: string;
  resultList?: { result?: EuropePmcResult[] };
};

function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }

function defaultRangeStart() {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 15);
  return isoDate(date);
}

function parseOptions(argv: string[]): Options {
  const parsed: Options = {
    writeStaging: false,
    topics: [],
    rangeStart: defaultRangeStart(),
    rangeEnd: isoDate(new Date()),
    maxPages: 1,
    pageSize: 100,
    delayMs: 250,
    includeOaFullText: false,
    includePreclinical: false,
    topicsFromDb: false,
  };
  for (const arg of argv) {
    if (arg === "--write-staging") parsed.writeStaging = true;
    else if (arg === "--dry-run") continue;
    else if (arg === "--include-oa-full-text") parsed.includeOaFullText = true;
    else if (arg === "--include-preclinical") parsed.includePreclinical = true;
    else if (arg === "--topics-from-db") parsed.topicsFromDb = true;
    else if (arg.startsWith("--topic=")) parsed.topics.push(arg.slice(8).trim());
    else if (arg.startsWith("--from=")) parsed.rangeStart = arg.slice(7);
    else if (arg.startsWith("--to=")) parsed.rangeEnd = arg.slice(5);
    else if (arg.startsWith("--max-pages=")) parsed.maxPages = Number(arg.slice(12));
    else if (arg.startsWith("--page-size=")) parsed.pageSize = Number(arg.slice(12));
    else if (arg.startsWith("--delay-ms=")) parsed.delayMs = Number(arg.slice(11));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.rangeStart) || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.rangeEnd) || parsed.rangeStart > parsed.rangeEnd) {
    throw new Error("--from and --to must be a valid ascending YYYY-MM-DD range");
  }
  if (!Number.isInteger(parsed.maxPages) || parsed.maxPages < 1 || parsed.maxPages > 1_000) throw new Error("--max-pages must be between 1 and 1000");
  if (!Number.isInteger(parsed.pageSize) || parsed.pageSize < 1 || parsed.pageSize > 1_000) throw new Error("--page-size must be between 1 and 1000");
  if (!Number.isFinite(parsed.delayMs) || parsed.delayMs < 0) throw new Error("--delay-ms must be non-negative");
  return parsed;
}

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function selectedTopics(names: string[], topicsFromDb: boolean): Promise<EvidenceTopicDefinition[]> {
  if (topicsFromDb) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required with --topics-from-db");
    const { pool } = await import("@workspace/db");
    const result = await pool.query<{
      canonical_name: string;
      display_name_zh: string | null;
      topic_type: EvidenceTopicDefinition["topicType"];
      query_terms: unknown;
    }>(`
      select canonical_name, display_name_zh, topic_type, query_terms
      from scientific_evidence_topics
      where is_active = true
      order by canonical_name
    `);
    return result.rows.map(row => ({
      canonicalName: row.canonical_name,
      displayNameZh: row.display_name_zh ?? row.canonical_name,
      topicType: row.topic_type,
      queryTerms: Array.isArray(row.query_terms)
        ? row.query_terms.filter((term): term is string => typeof term === "string" && Boolean(term.trim()))
        : [row.canonical_name],
    }));
  }
  if (names.length === 0) return DEFAULT_EVIDENCE_TOPICS;
  return names.map(name => DEFAULT_EVIDENCE_TOPICS.find(topic => topic.canonicalName === name) ?? {
    canonicalName: name,
    displayNameZh: name,
    topicType: "ingredient" as const,
    queryTerms: [name],
  });
}

async function fetchSearchPage(
  query: string,
  cursorMark: string,
  pageSize: number,
): Promise<SearchResponse> {
  const url = new URL(`${EUROPE_PMC_API}/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("cursorMark", cursorMark);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "FACTA/1.0 (https://facta.replit.app; scientific evidence indexer)" },
    });
    if (!response.ok) throw new Error(`Europe PMC search failed: HTTP ${response.status}`);
    return await response.json() as SearchResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLicensedFullText(source: NormalizedScientificSource): Promise<NormalizedScientificSource> {
  if (!source.pmcid || source.contentReuseStatus !== "oa_commercial_reuse") return source;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${EUROPE_PMC_API}/${encodeURIComponent(source.pmcid)}/fullTextXML`, {
      signal: controller.signal,
      headers: { "User-Agent": "FACTA/1.0 (https://facta.replit.app; licensed OA evidence indexer)" },
    });
    if (!response.ok) return source;
    return attachLicensedFullText(source, await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

function consumerUseStatus(source: NormalizedScientificSource, forceReferenceOnly = false) {
  if (source.integrityStatus === "retracted" || source.integrityStatus === "expression_of_concern") return "excluded";
  if (forceReferenceOnly) return "reference_only";
  if (["preprint", "animal", "in_vitro"].includes(source.studyDesign)) return "reference_only";
  return "pending_review";
}

function qualitySummary(sources: NormalizedScientificSource[], rejected: number, duplicates: number, forceReferenceOnly = false) {
  const fetched = sources.length + rejected + duplicates;
  const count = (predicate: (source: NormalizedScientificSource) => boolean) => sources.filter(predicate).length;
  return {
    fetched,
    accepted: sources.length,
    rejected,
    duplicates,
    acceptedRate: fetched ? sources.length / fetched : 0,
    withAbstract: count(source => Boolean(source.abstractText)),
    abstractCoverageRate: sources.length ? count(source => Boolean(source.abstractText)) / sources.length : 0,
    withDoi: count(source => Boolean(source.doi)),
    doiCoverageRate: sources.length ? count(source => Boolean(source.doi)) / sources.length : 0,
    openAccess: count(source => source.isOpenAccess),
    licensedFullText: count(source => Boolean(source.fullTextText)),
    integrityExcluded: count(source => consumerUseStatus(source, forceReferenceOnly) === "excluded"),
    referenceOnly: count(source => consumerUseStatus(source, forceReferenceOnly) === "reference_only"),
    consumerEligibleWithoutReview: 0,
    byStudyDesign: Object.fromEntries([...new Set(sources.map(source => source.studyDesign))].sort().map(design => [
      design,
      count(source => source.studyDesign === design),
    ])),
  };
}

async function writeTopic(input: {
  topic: EvidenceTopicDefinition;
  query: string;
  sources: NormalizedScientificSource[];
  rejected: number;
  duplicates: number;
  cursorStart: string;
  cursorEnd: string;
  rangeStart: string;
  rangeEnd: string;
  forceReferenceOnly: boolean;
}) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required with --write-staging");
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const topicResult = await client.query<{ id: number }>(`
      insert into scientific_evidence_topics (
        canonical_name, display_name_zh, topic_type, aliases, query_terms, is_active, updated_at
      ) values ($1, $2, $3, '[]'::jsonb, $4::jsonb, true, now())
      on conflict (canonical_name) do update set
        display_name_zh = excluded.display_name_zh,
        topic_type = excluded.topic_type,
        query_terms = excluded.query_terms,
        is_active = true,
        updated_at = now()
      returning id
    `, [input.topic.canonicalName, input.topic.displayNameZh, input.topic.topicType, JSON.stringify(input.topic.queryTerms)]);
    const topicId = topicResult.rows[0]!.id;
    const summary = qualitySummary(input.sources, input.rejected, input.duplicates, input.forceReferenceOnly);
    const run = await client.query<{ id: string }>(`
      insert into scientific_evidence_sync_runs (
        provider, topic_id, query_text, range_start, range_end, cursor_start, cursor_end,
        status, fetched_count, accepted_count, rejected_count, duplicate_count,
        integrity_excluded_count, licensed_full_text_count, quality_summary, finished_at
      ) values (
        'europe_pmc', $1, $2, $3::date, $4::date, $5, $6, 'completed',
        $7, $8, $9, $10, $11, $12, $13::jsonb, now()
      ) returning id
    `, [
      topicId, input.query, input.rangeStart, input.rangeEnd, input.cursorStart, input.cursorEnd,
      summary.fetched, summary.accepted, summary.rejected, summary.duplicates,
      summary.integrityExcluded, summary.licensedFullText, JSON.stringify(summary),
    ]);
    const syncRunId = Number(run.rows[0]!.id);
    const rows = input.sources.map(source => ({
      ...source,
      consumerUseStatus: consumerUseStatus(source, input.forceReferenceOnly),
    }));
    for (let offset = 0; offset < rows.length; offset += 200) {
      const batch = rows.slice(offset, offset + 200);
      await client.query(`
        insert into scientific_evidence_sources (
          last_sync_run_id, provider, external_id, pmid, pmcid, doi, title, abstract_text, abstract_sha256,
          full_text_text, full_text_sha256, journal, publication_date, publication_year,
          publication_types, mesh_terms, authors, source_url, is_open_access, license_id,
          content_reuse_status, study_design, study_design_rank, integrity_status,
          integrity_checked_at, quality_flags, raw_metadata, retrieved_at, updated_at
        )
        select $2, x.provider, x.external_id, x.pmid, x.pmcid, x.doi, x.title,
          x.abstract_text, x.abstract_sha256, x.full_text_text, x.full_text_sha256,
          x.journal, x.publication_date::date, x.publication_year, x.publication_types,
          x.mesh_terms, x.authors, x.source_url, x.is_open_access, x.license_id,
          x.content_reuse_status, x.study_design, x.study_design_rank, x.integrity_status,
          case when x.integrity_status = 'unchecked' then null else now() end,
          x.quality_flags, x.raw_metadata, now(), now()
        from jsonb_to_recordset($1::jsonb) as x(
          provider text, external_id text, pmid text, pmcid text, doi text, title text,
          abstract_text text, abstract_sha256 text, full_text_text text, full_text_sha256 text,
          journal text, publication_date text, publication_year integer,
          publication_types jsonb, mesh_terms jsonb, authors jsonb, source_url text,
          is_open_access boolean, license_id text, content_reuse_status text,
          study_design text, study_design_rank integer, integrity_status text,
          quality_flags jsonb, raw_metadata jsonb, consumer_use_status text
        )
        on conflict (provider, external_id) do update set
          last_sync_run_id = excluded.last_sync_run_id,
          pmid = coalesce(excluded.pmid, scientific_evidence_sources.pmid),
          pmcid = coalesce(excluded.pmcid, scientific_evidence_sources.pmcid),
          doi = coalesce(excluded.doi, scientific_evidence_sources.doi),
          title = excluded.title,
          abstract_text = coalesce(excluded.abstract_text, scientific_evidence_sources.abstract_text),
          abstract_sha256 = coalesce(excluded.abstract_sha256, scientific_evidence_sources.abstract_sha256),
          full_text_text = coalesce(excluded.full_text_text, scientific_evidence_sources.full_text_text),
          full_text_sha256 = coalesce(excluded.full_text_sha256, scientific_evidence_sources.full_text_sha256),
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
          integrity_status = case
            when scientific_evidence_sources.integrity_status in ('retracted', 'expression_of_concern')
              then scientific_evidence_sources.integrity_status
            else excluded.integrity_status
          end,
          quality_flags = excluded.quality_flags,
          raw_metadata = excluded.raw_metadata,
          retrieved_at = now(), updated_at = now()
      `, [JSON.stringify(batch.map(row => ({
        provider: row.provider, external_id: row.externalId, pmid: row.pmid, pmcid: row.pmcid,
        doi: row.doi, title: row.title, abstract_text: row.abstractText,
        abstract_sha256: row.abstractSha256, full_text_text: row.fullTextText,
        full_text_sha256: row.fullTextSha256, journal: row.journal,
        publication_date: row.publicationDate, publication_year: row.publicationYear,
        publication_types: row.publicationTypes, mesh_terms: row.meshTerms, authors: row.authors,
        source_url: row.sourceUrl, is_open_access: row.isOpenAccess, license_id: row.licenseId,
        content_reuse_status: row.contentReuseStatus, study_design: row.studyDesign,
        study_design_rank: row.studyDesignRank, integrity_status: row.integrityStatus,
        quality_flags: row.qualityFlags, raw_metadata: row.rawMetadata,
        consumer_use_status: row.consumerUseStatus,
      }))), syncRunId]);
      await client.query(`
        insert into scientific_evidence_topic_links (
          source_id, topic_id, sync_run_id, matched_terms, relevance_method, consumer_use_status,
          review_status, quality_flags, updated_at
        )
        select s.id, $1, $2, $3::jsonb, 'query_match', x.consumer_use_status,
          'not_reviewed', x.quality_flags, now()
        from jsonb_to_recordset($4::jsonb) as x(
          provider text, external_id text, consumer_use_status text, quality_flags jsonb
        )
        join scientific_evidence_sources s
          on s.provider = x.provider and s.external_id = x.external_id
        on conflict (source_id, topic_id) do update set
          sync_run_id = excluded.sync_run_id,
          consumer_use_status = case
            when excluded.consumer_use_status = 'excluded' then 'excluded'
            when scientific_evidence_topic_links.review_status = 'reviewed'
              then scientific_evidence_topic_links.consumer_use_status
            else excluded.consumer_use_status
          end,
          quality_flags = excluded.quality_flags,
          updated_at = now()
      `, [
        topicId,
        syncRunId,
        JSON.stringify(input.topic.queryTerms),
        JSON.stringify(batch.map(row => ({
          provider: row.provider,
          external_id: row.externalId,
          consumer_use_status: row.consumerUseStatus,
          quality_flags: row.qualityFlags,
        }))),
      ]);
    }
    await client.query("update scientific_evidence_topics set last_synced_at = now(), updated_at = now() where id = $1", [topicId]);
    await client.query("commit");
    return { topicId, syncRunId, upserted: input.sources.length, summary };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function importTopic(topic: EvidenceTopicDefinition, options: Options) {
  const query = buildEuropePmcQuery(topic, options.rangeStart, options.rangeEnd, options.includePreclinical);
  const cursorStart = "*";
  let cursor = cursorStart;
  let hitCount = 0;
  let rejected = 0;
  let duplicates = 0;
  const sources = new Map<string, NormalizedScientificSource>();
  for (let page = 0; page < options.maxPages; page += 1) {
    const response = await fetchSearchPage(query, cursor, options.pageSize);
    hitCount = response.hitCount ?? hitCount;
    const results = response.resultList?.result ?? [];
    if (results.length === 0) break;
    for (const result of results) {
      try {
        let source = normalizeEuropePmcResult(result, options.rangeStart, options.rangeEnd);
        if (options.includeOaFullText) source = await fetchLicensedFullText(source);
        if (sources.has(source.externalId)) duplicates += 1;
        sources.set(source.externalId, source);
      } catch {
        rejected += 1;
      }
    }
    const next = response.nextCursorMark;
    if (!next || next === cursor) break;
    cursor = next;
    if (options.delayMs) await sleep(options.delayMs);
  }
  const normalized = [...sources.values()];
  const summary = qualitySummary(normalized, rejected, duplicates, options.includePreclinical);
  const write = options.writeStaging ? await writeTopic({
    topic, query, sources: normalized, rejected, duplicates,
    cursorStart, cursorEnd: cursor, rangeStart: options.rangeStart, rangeEnd: options.rangeEnd,
    forceReferenceOnly: options.includePreclinical,
  }) : null;
  return { topic: topic.canonicalName, query, hitCount, sampledOrImported: summary, write };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const output = [];
  try {
    for (const topic of await selectedTopics(options.topics, options.topicsFromDb)) {
      output.push(await importTopic(topic, options));
    }
  } finally {
    if (options.writeStaging || options.topicsFromDb) {
      const { pool } = await import("@workspace/db");
      await pool.end();
    }
  }
  process.stdout.write(`${JSON.stringify({
    mode: options.writeStaging ? "write-staging" : "dry-run",
    dateRange: { from: options.rangeStart, to: options.rangeEnd },
    fullTextPolicy: options.includeOaFullText
      ? "Store only explicit CC0, CC BY, or CC BY-SA Europe PMC OA full text"
      : "Metadata and abstracts; no full text fetched",
    evidenceScope: options.includePreclinical
      ? "Title/abstract topic matches including preclinical evidence; indirect designs stay reference-only"
      : "Human studies, systematic reviews, meta-analyses and guidelines",
    topics: output,
  }, null, 2)}\n`);
}

await main();
