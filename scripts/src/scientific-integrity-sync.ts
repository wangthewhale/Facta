import {
  collapseIntegrityRecords,
  parseRetractionWatchCsv,
  RETRACTION_WATCH_CSV_URL,
} from "./science/retractionWatch.js";

const write = process.argv.includes("--write-staging");
const unknown = process.argv.slice(2).filter(arg => !["--write-staging", "--dry-run"].includes(arg));
if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(", ")}`);

const response = await fetch(RETRACTION_WATCH_CSV_URL, {
  headers: { "User-Agent": "FACTA/1.0 (https://facta.replit.app; research integrity sync)" },
});
if (!response.ok) throw new Error(`Retraction Watch download failed: HTTP ${response.status}`);
const parsed = parseRetractionWatchCsv(await response.text());
const collapsed = collapseIntegrityRecords(parsed.records);

const summary: Record<string, unknown> = {
  mode: write ? "write-staging" : "dry-run",
  source: RETRACTION_WATCH_CSV_URL,
  parsedRecords: parsed.records.length,
  rejectedRows: parsed.rejected,
  matchableIdentifierRate: (parsed.records.length + parsed.rejected) > 0
    ? parsed.records.length / (parsed.records.length + parsed.rejected)
    : 0,
  uniqueOriginalWorks: collapsed.length,
  withOriginalDoi: collapsed.filter(record => Boolean(record.originalPaperDoi)).length,
  withOriginalPmid: collapsed.filter(record => Boolean(record.originalPaperPmid)).length,
  retracted: collapsed.filter(record => record.integrityStatus === "retracted").length,
  expressionsOfConcern: collapsed.filter(record => record.integrityStatus === "expression_of_concern").length,
  corrections: collapsed.filter(record => record.integrityStatus === "corrected").length,
};

if (write) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required with --write-staging");
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const payload = collapsed.map(record => ({
      doi: record.originalPaperDoi,
      pmid: record.originalPaperPmid,
      integrity_status: record.integrityStatus,
      record_id: record.recordId,
      retraction_nature: record.retractionNature,
      retraction_date: record.retractionDate,
      reason: record.reason,
    }));
    let matched = 0;
    for (let offset = 0; offset < payload.length; offset += 1_000) {
      const batch = payload.slice(offset, offset + 1_000);
      const result = await client.query(`
        with integrity as (
          select * from jsonb_to_recordset($1::jsonb) as x(
            doi text, pmid text, integrity_status text, record_id text,
            retraction_nature text, retraction_date text, reason text
          )
        )
        update scientific_evidence_sources s
        set integrity_status = case
              when s.integrity_status = 'retracted' then 'retracted'
              when x.integrity_status = 'retracted' then 'retracted'
              when s.integrity_status = 'expression_of_concern' then 'expression_of_concern'
              when x.integrity_status = 'expression_of_concern' then 'expression_of_concern'
              when x.integrity_status = 'corrected' then 'corrected'
              else s.integrity_status
            end,
            integrity_checked_at = now(),
            quality_flags = case
              when x.integrity_status in ('retracted', 'expression_of_concern')
                then coalesce(s.quality_flags, '[]'::jsonb) || jsonb_build_array(
                  jsonb_build_object(
                    'code', 'crossref_retraction_watch',
                    'recordId', x.record_id,
                    'nature', x.retraction_nature,
                    'date', x.retraction_date,
                    'reason', x.reason
                  )
                )
              else s.quality_flags
            end,
            updated_at = now()
        from integrity x
        where (x.doi is not null and lower(s.doi) = lower(x.doi))
           or (x.pmid is not null and s.pmid = x.pmid)
      `, [JSON.stringify(batch)]);
      matched += result.rowCount ?? 0;
    }
    await client.query(`
      update scientific_evidence_topic_links l
      set consumer_use_status = 'excluded', updated_at = now()
      from scientific_evidence_sources s
      where l.source_id = s.id
        and s.integrity_status in ('retracted', 'expression_of_concern')
    `);
    await client.query(`
      update scientific_evidence_claims c
      set extraction_status = 'rejected', updated_at = now()
      from scientific_evidence_sources s
      where c.source_id = s.id
        and s.integrity_status in ('retracted', 'expression_of_concern')
    `);
    await client.query(`
      insert into scientific_evidence_sync_runs (
        provider, query_text, range_start, range_end, status, fetched_count,
        accepted_count, rejected_count, quality_summary, finished_at
      ) values (
        'crossref_retraction_watch', 'daily full dataset integrity reconciliation',
        '2011-01-01'::date, current_date, 'completed', $1, $2, $3, $4::jsonb, now()
      )
    `, [parsed.records.length + parsed.rejected, matched, parsed.rejected, JSON.stringify({ ...summary, matchedIndexedSources: matched })]);
    await client.query("commit");
    summary.matchedIndexedSources = matched;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
