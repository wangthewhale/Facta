-- FACTA rights-aware scientific evidence library (2011 onward by importer default).
--
-- This migration creates an evidence staging/index layer. It does not change
-- product scores. Imported studies remain pending review, and retracted or
-- expression-of-concern records are never consumer-eligible.

begin;

create table if not exists scientific_evidence_topics (
  id serial primary key,
  canonical_name text not null unique,
  display_name_zh text,
  topic_type text not null default 'ingredient',
  aliases jsonb not null default '[]'::jsonb,
  query_terms jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scientific_evidence_topics_type_check
    check (topic_type in ('ingredient', 'additive', 'nutrient', 'diet_pattern', 'health_outcome'))
);

create table if not exists scientific_evidence_sync_runs (
  id bigserial primary key,
  provider text not null,
  topic_id integer references scientific_evidence_topics(id),
  query_text text,
  range_start date not null,
  range_end date not null,
  cursor_start text,
  cursor_end text,
  status text not null default 'running',
  fetched_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  duplicate_count integer not null default 0,
  integrity_excluded_count integer not null default 0,
  licensed_full_text_count integer not null default 0,
  quality_summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint scientific_evidence_sync_runs_status_check
    check (status in ('running', 'completed', 'failed'))
);

create table if not exists scientific_evidence_sources (
  id bigserial primary key,
  last_sync_run_id bigint references scientific_evidence_sync_runs(id) on delete set null,
  provider text not null,
  external_id text not null,
  pmid text,
  pmcid text,
  doi text,
  title text not null,
  abstract_text text,
  abstract_sha256 text,
  full_text_text text,
  full_text_sha256 text,
  journal text,
  publication_date date,
  publication_year integer,
  publication_types jsonb not null default '[]'::jsonb,
  mesh_terms jsonb not null default '[]'::jsonb,
  authors jsonb not null default '[]'::jsonb,
  source_url text not null,
  is_open_access boolean not null default false,
  license_id text,
  content_reuse_status text not null default 'metadata_only',
  study_design text not null default 'other',
  study_design_rank integer not null default 90,
  integrity_status text not null default 'unchecked',
  integrity_checked_at timestamptz,
  quality_flags jsonb not null default '[]'::jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scientific_evidence_sources_provider_external_uidx unique (provider, external_id),
  constraint scientific_evidence_sources_reuse_check check (
    content_reuse_status in ('metadata_only', 'abstract_internal_only', 'oa_commercial_reuse', 'oa_noncommercial_only', 'unknown')
  ),
  constraint scientific_evidence_sources_integrity_check check (
    integrity_status in ('unchecked', 'current', 'corrected', 'expression_of_concern', 'retracted')
  ),
  constraint scientific_evidence_sources_year_check check (
    publication_year is null or publication_year between 1800 and 2200
  )
);

create unique index if not exists scientific_evidence_sources_pmid_uidx
  on scientific_evidence_sources (pmid) where pmid is not null;
create index if not exists scientific_evidence_sources_doi_idx
  on scientific_evidence_sources (lower(doi)) where doi is not null;
create index if not exists scientific_evidence_sources_date_idx
  on scientific_evidence_sources (publication_date desc);
create index if not exists scientific_evidence_sources_integrity_idx
  on scientific_evidence_sources (integrity_status, study_design_rank);

create table if not exists scientific_evidence_topic_links (
  id bigserial primary key,
  source_id bigint not null references scientific_evidence_sources(id) on delete cascade,
  topic_id integer not null references scientific_evidence_topics(id) on delete cascade,
  sync_run_id bigint references scientific_evidence_sync_runs(id) on delete set null,
  matched_terms jsonb not null default '[]'::jsonb,
  relevance_method text not null default 'query_match',
  relevance_score numeric(5,4),
  consumer_use_status text not null default 'pending_review',
  review_status text not null default 'not_reviewed',
  reviewed_at timestamptz,
  reviewed_by text,
  quality_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scientific_evidence_topic_links_uidx unique (source_id, topic_id),
  constraint scientific_evidence_topic_links_consumer_check check (
    consumer_use_status in ('pending_review', 'eligible', 'reference_only', 'excluded')
  ),
  constraint scientific_evidence_topic_links_review_check check (
    review_status in ('not_reviewed', 'ai_extracted_pending_review', 'reviewed', 'rejected')
  )
);
create index if not exists scientific_evidence_topic_links_queue_idx
  on scientific_evidence_topic_links (topic_id, consumer_use_status, review_status);

-- Keep the migration idempotent if an earlier draft already exists in staging.
alter table scientific_evidence_sources
  add column if not exists last_sync_run_id bigint references scientific_evidence_sync_runs(id) on delete set null;
alter table scientific_evidence_topic_links
  add column if not exists sync_run_id bigint references scientific_evidence_sync_runs(id) on delete set null;
create index if not exists scientific_evidence_topic_links_sync_run_idx
  on scientific_evidence_topic_links (sync_run_id);

create table if not exists scientific_evidence_claims (
  id bigserial primary key,
  source_id bigint not null references scientific_evidence_sources(id) on delete cascade,
  topic_id integer not null references scientific_evidence_topics(id) on delete cascade,
  population_text text,
  exposure_text text,
  comparator_text text,
  outcome_text text,
  direction text not null default 'unclear',
  effect_estimate jsonb,
  limitations jsonb not null default '[]'::jsonb,
  extraction_status text not null default 'not_queued',
  body_certainty text,
  consumer_summary_zh text,
  source_quote_locator text,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scientific_evidence_claims_direction_check
    check (direction in ('beneficial', 'harmful', 'mixed', 'no_effect', 'unclear')),
  constraint scientific_evidence_claims_extraction_check
    check (extraction_status in ('not_queued', 'ai_extracted_pending_review', 'reviewed', 'rejected')),
  constraint scientific_evidence_claims_certainty_check
    check (body_certainty is null or body_certainty in ('high', 'moderate', 'low', 'very_low'))
);

-- Seed only query concepts, never health conclusions. Importers expand these
-- concepts into publication metadata and leave claims pending human review.
insert into scientific_evidence_topics (canonical_name, display_name_zh, topic_type, aliases, query_terms)
values
  ('added sugar', '添加糖', 'nutrient', '["sucrose","fructose","sugar-sweetened beverage","砂糖","蔗糖","果糖","糖漿","葡萄糖"]', '["added sugar","sugar sweetened beverage","free sugars"]'),
  ('sodium', '鈉', 'nutrient', '["salt","sodium chloride","食鹽","鹽","氯化鈉"]', '["dietary sodium","salt intake"]'),
  ('saturated fat', '飽和脂肪', 'nutrient', '["saturated fatty acid"]', '["saturated fat","saturated fatty acid"]'),
  ('trans fat', '反式脂肪', 'nutrient', '["trans fatty acid","partially hydrogenated oil","人造奶油","氫化植物油","部分氫化油"]', '["trans fat","trans fatty acid","partially hydrogenated oil"]'),
  ('dietary fiber', '膳食纖維', 'nutrient', '["fibre"]', '["dietary fiber","dietary fibre"]'),
  ('ultra-processed food', '超加工食品', 'diet_pattern', '["UPF","NOVA classification"]', '["ultra processed food","NOVA classification"]'),
  ('nitrite and nitrate', '亞硝酸鹽與硝酸鹽', 'additive', '["sodium nitrite","potassium nitrate","亞硝酸鈉","硝酸鉀"]', '["dietary nitrite","dietary nitrate","processed meat nitrite"]'),
  ('non-sugar sweeteners', '非糖甜味劑', 'additive', '["artificial sweetener","aspartame","sucralose","acesulfame potassium","saccharin","甜味劑","阿斯巴甜","蔗糖素","醋磺內酯鉀","糖精"]', '["non sugar sweetener","artificial sweetener","aspartame","sucralose","acesulfame potassium","saccharin"]'),
  ('food emulsifiers', '食品乳化劑', 'additive', '["emulsifier","carboxymethylcellulose","polysorbate 80","乳化劑","羧甲基纖維素","聚山梨醇酯80"]', '["food emulsifier","dietary emulsifier","carboxymethylcellulose","polysorbate 80"]'),
  ('carrageenan', '鹿角菜膠', 'additive', '["E407","鹿角菜膠"]', '["carrageenan","E407"]'),
  ('benzoates', '苯甲酸鹽', 'additive', '["benzoic acid","sodium benzoate","E211","苯甲酸鈉","苯甲酸"]', '["sodium benzoate","benzoic acid","benzoate preservative"]'),
  ('titanium dioxide', '二氧化鈦', 'additive', '["E171","二氧化鈦"]', '["food grade titanium dioxide","titanium dioxide ingestion","E171"]')
on conflict (canonical_name) do update set
  display_name_zh = excluded.display_name_zh,
  topic_type = excluded.topic_type,
  aliases = excluded.aliases,
  query_terms = excluded.query_terms,
  updated_at = now();

commit;

-- Rollback (only before consumer claims are reviewed):
-- drop table if exists scientific_evidence_claims;
-- drop table if exists scientific_evidence_topic_links;
-- drop table if exists scientific_evidence_sources;
-- drop table if exists scientific_evidence_sync_runs;
-- drop table if exists scientific_evidence_topics;
