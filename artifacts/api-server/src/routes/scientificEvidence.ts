import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

function evidenceLibraryUnavailable(error: unknown): boolean {
  return (error as { code?: string }).code === "42P01";
}

router.get("/evidence/stats", async (_req, res): Promise<void> => {
  try {
    const result = await pool.query<{
      total_sources: number;
      topic_count: number;
      current_sources: number;
      integrity_excluded: number;
      open_access_sources: number;
      abstract_sources: number;
      licensed_full_text_sources: number;
      reviewed_eligible_links: number;
      last_synced_at: Date | null;
    }>(`
      select
        (select count(*)::int from scientific_evidence_sources) as total_sources,
        (select count(*)::int from scientific_evidence_topics where is_active = true) as topic_count,
        (select count(*)::int from scientific_evidence_sources where integrity_status not in ('retracted', 'expression_of_concern')) as current_sources,
        (select count(*)::int from scientific_evidence_sources where integrity_status in ('retracted', 'expression_of_concern')) as integrity_excluded,
        (select count(*)::int from scientific_evidence_sources where is_open_access = true) as open_access_sources,
        (select count(*)::int from scientific_evidence_sources where abstract_text is not null) as abstract_sources,
        (select count(*)::int from scientific_evidence_sources where full_text_text is not null) as licensed_full_text_sources,
        (select count(*)::int from scientific_evidence_topic_links where consumer_use_status = 'eligible' and review_status = 'reviewed') as reviewed_eligible_links,
        (select max(finished_at) from scientific_evidence_sync_runs where status = 'completed') as last_synced_at
    `);
    const row = result.rows[0]!;
    res.json({
      totalSources: Number(row.total_sources),
      topicCount: Number(row.topic_count),
      currentSources: Number(row.current_sources),
      integrityExcluded: Number(row.integrity_excluded),
      openAccessSources: Number(row.open_access_sources),
      abstractSources: Number(row.abstract_sources),
      licensedFullTextSources: Number(row.licensed_full_text_sources),
      reviewedEligibleLinks: Number(row.reviewed_eligible_links),
      consumerClaimsAutoApproved: 0,
      lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    });
  } catch (error) {
    if (evidenceLibraryUnavailable(error)) {
      res.status(503).json({ error: "Scientific evidence migration has not been applied" });
      return;
    }
    throw error;
  }
});

router.get("/evidence/topics", async (_req, res): Promise<void> => {
  try {
    const result = await pool.query<{
      canonical_name: string;
      display_name_zh: string | null;
      topic_type: string;
      source_count: number;
      eligible_count: number;
      last_synced_at: Date | null;
    }>(`
      select t.canonical_name, t.display_name_zh, t.topic_type,
        count(l.id)::int as source_count,
        count(l.id) filter (where l.consumer_use_status = 'eligible' and l.review_status = 'reviewed')::int as eligible_count,
        t.last_synced_at
      from scientific_evidence_topics t
      left join scientific_evidence_topic_links l on l.topic_id = t.id
      where t.is_active = true
      group by t.id
      order by t.canonical_name
    `);
    res.json(result.rows.map(row => ({
      canonicalName: row.canonical_name,
      displayNameZh: row.display_name_zh,
      topicType: row.topic_type,
      sourceCount: Number(row.source_count),
      reviewedEligibleCount: Number(row.eligible_count),
      lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    })));
  } catch (error) {
    if (evidenceLibraryUnavailable(error)) {
      res.status(503).json({ error: "Scientific evidence migration has not been applied" });
      return;
    }
    throw error;
  }
});

router.get("/evidence/topics/:topic/sources", async (req, res): Promise<void> => {
  const topic = req.params.topic?.normalize("NFKC").trim() ?? "";
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  if (!topic || topic.length > 120) {
    res.status(400).json({ error: "topic must be between 1 and 120 characters" });
    return;
  }
  try {
    const result = await pool.query<{
      canonical_name: string;
      display_name_zh: string | null;
      title: string;
      journal: string | null;
      publication_date: string | null;
      publication_types: unknown;
      study_design: string;
      study_design_rank: number;
      integrity_status: string;
      consumer_use_status: string;
      review_status: string;
      source_url: string;
      doi: string | null;
      pmid: string | null;
      is_open_access: boolean;
      license_id: string | null;
    }>(`
      select t.canonical_name, t.display_name_zh, s.title, s.journal,
        s.publication_date::text, s.publication_types, s.study_design,
        s.study_design_rank, s.integrity_status, l.consumer_use_status,
        l.review_status, s.source_url, s.doi, s.pmid, s.is_open_access, s.license_id
      from scientific_evidence_topics t
      join scientific_evidence_topic_links l on l.topic_id = t.id
      join scientific_evidence_sources s on s.id = l.source_id
      where lower(t.canonical_name) = lower($1)
        and s.integrity_status not in ('retracted', 'expression_of_concern')
        and l.consumer_use_status <> 'excluded'
      order by
        case when l.consumer_use_status = 'eligible' and l.review_status = 'reviewed' then 0 else 1 end,
        s.study_design_rank,
        s.publication_date desc nulls last
      limit $2
    `, [topic, limit]);
    res.json({
      topic: result.rows[0]?.canonical_name ?? topic,
      displayNameZh: result.rows[0]?.display_name_zh ?? null,
      important: "Study design rank is a retrieval aid, not a GRADE certainty rating or a health conclusion.",
      sources: result.rows.map(row => ({
        title: row.title,
        journal: row.journal,
        publicationDate: row.publication_date,
        publicationTypes: row.publication_types,
        studyDesign: row.study_design,
        studyDesignRank: row.study_design_rank,
        integrityStatus: row.integrity_status,
        consumerUseStatus: row.consumer_use_status,
        reviewStatus: row.review_status,
        sourceUrl: row.source_url,
        doi: row.doi,
        pmid: row.pmid,
        isOpenAccess: row.is_open_access,
        licenseId: row.license_id,
      })),
    });
  } catch (error) {
    if (evidenceLibraryUnavailable(error)) {
      res.status(503).json({ error: "Scientific evidence migration has not been applied" });
      return;
    }
    throw error;
  }
});

router.get("/products/:id/scientific-evidence", async (req, res): Promise<void> => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId < 1) {
    res.status(400).json({ error: "product id must be a positive integer" });
    return;
  }
  try {
    const product = await pool.query<{ id: number }>("select id from products where id = $1", [productId]);
    if (!product.rows[0]) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const result = await pool.query<{
      canonical_name: string;
      display_name_zh: string | null;
      topic_type: string;
      ingredient_match: boolean;
      nutrition_match: boolean;
      current_source_count: number;
      reviewed_eligible_count: number;
      integrity_excluded_count: number;
      last_synced_at: Date | null;
    }>(`
      with product_context as (
        select p.id, lower(coalesce(p.ingredients_list, '')) as ingredients,
          nf.total_sugars, nf.sodium, nf.saturated_fat, nf.trans_fat, nf.dietary_fiber
        from products p
        left join nutrition_facts nf on nf.product_id = p.id
        where p.id = $1
      ), matched_topics as (
        select t.id, t.canonical_name, t.display_name_zh, t.topic_type, t.last_synced_at,
          (
            position(lower(t.canonical_name) in pc.ingredients) > 0
            or (t.display_name_zh is not null and position(lower(t.display_name_zh) in pc.ingredients) > 0)
            or exists (
              select 1
              from jsonb_array_elements_text(t.aliases) alias(value)
              where length(trim(alias.value)) >= 2
                and position(lower(alias.value) in pc.ingredients) > 0
            )
          ) as ingredient_match,
          case t.canonical_name
            when 'added sugar' then coalesce(pc.total_sugars, 0) > 0
            when 'sodium' then coalesce(pc.sodium, 0) > 0
            when 'saturated fat' then coalesce(pc.saturated_fat, 0) > 0
            when 'trans fat' then coalesce(pc.trans_fat, 0) > 0
            when 'dietary fiber' then coalesce(pc.dietary_fiber, 0) > 0
            else false
          end as nutrition_match
        from scientific_evidence_topics t
        cross join product_context pc
        where t.is_active = true
      )
      select mt.canonical_name, mt.display_name_zh, mt.topic_type,
        mt.ingredient_match, mt.nutrition_match,
        count(distinct l.source_id) filter (
          where s.integrity_status not in ('retracted', 'expression_of_concern')
            and l.consumer_use_status <> 'excluded'
        )::int as current_source_count,
        count(distinct l.source_id) filter (
          where s.integrity_status not in ('retracted', 'expression_of_concern')
            and l.consumer_use_status = 'eligible' and l.review_status = 'reviewed'
        )::int as reviewed_eligible_count,
        count(distinct l.source_id) filter (
          where s.integrity_status in ('retracted', 'expression_of_concern')
             or l.consumer_use_status = 'excluded'
        )::int as integrity_excluded_count,
        mt.last_synced_at
      from matched_topics mt
      left join scientific_evidence_topic_links l on l.topic_id = mt.id
      left join scientific_evidence_sources s on s.id = l.source_id
      where mt.ingredient_match or mt.nutrition_match
      group by mt.id, mt.canonical_name, mt.display_name_zh, mt.topic_type,
        mt.ingredient_match, mt.nutrition_match, mt.last_synced_at
      order by reviewed_eligible_count desc, current_source_count desc, mt.canonical_name
    `, [productId]);
    res.json({
      productId,
      important: "Matched studies are an evidence index, not proof that the packaged product causes an outcome. Only reviewed eligible evidence may support a consumer conclusion.",
      matchedTopics: result.rows.map(row => ({
        canonicalName: row.canonical_name,
        displayNameZh: row.display_name_zh,
        topicType: row.topic_type,
        matchBasis: row.ingredient_match && row.nutrition_match
          ? "ingredient_and_nutrition"
          : row.ingredient_match ? "ingredient" : "nutrition",
        currentSourceCount: Number(row.current_source_count),
        reviewedEligibleCount: Number(row.reviewed_eligible_count),
        integrityExcludedCount: Number(row.integrity_excluded_count),
        lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    if (evidenceLibraryUnavailable(error)) {
      res.status(503).json({ error: "Scientific evidence migration has not been applied" });
      return;
    }
    throw error;
  }
});

export default router;
