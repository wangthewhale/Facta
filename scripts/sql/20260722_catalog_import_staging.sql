-- FACTA source-backed catalog ingestion staging tables.
--
-- This migration does not touch canonical products, scores, or verified label
-- facts. Imported rows remain unverified candidates until a separate promotion
-- workflow approves them.

begin;

create table if not exists catalog_import_runs (
  id bigserial primary key,
  source_key text not null,
  source_url text not null,
  source_license text not null,
  status text not null default 'running',
  payload_sha256 text,
  fetched_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  evidence_counts jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint catalog_import_runs_status_check
    check (status in ('running', 'completed', 'failed'))
);

create table if not exists catalog_import_candidates (
  id bigserial primary key,
  import_run_id bigint references catalog_import_runs(id),
  source_key text not null,
  source_record_id text not null,
  source_url text not null,
  source_license text not null,
  source_updated_at timestamptz,
  payload_sha256 text not null,
  canonical_key text not null,
  product_name text not null,
  brand_name text,
  category_name text,
  package_spec text,
  gtin text,
  traceability_code text,
  image_urls jsonb not null default '[]'::jsonb,
  ingredients_raw text,
  nutrition_raw jsonb,
  evidence_tier text not null default 'catalog_only',
  nutrition_analysis_eligible boolean not null default false,
  positive_buy_eligible boolean not null default false,
  verification_status text not null default 'imported_unverified',
  ai_enrichment_status text not null default 'not_queued',
  quality_flags jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  promoted_product_id integer,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_import_candidates_source_uidx
    unique (source_key, source_record_id),
  constraint catalog_import_candidates_evidence_tier_check
    check (evidence_tier in ('catalog_only', 'nutrition_ready', 'ingredients_ready', 'review_ready')),
  constraint catalog_import_candidates_verification_check
    check (verification_status in ('imported_unverified', 'pending_review', 'promoted', 'rejected')),
  constraint catalog_import_candidates_ai_status_check
    check (ai_enrichment_status in ('not_queued', 'queued', 'processing', 'extracted_pending_review', 'failed')),
  constraint catalog_import_candidates_gtin_check
    check (gtin is null or gtin ~ '^[0-9]{8}$|^[0-9]{12,14}$')
);

-- Keep this as a plain column index. Replit's development-to-production
-- migration validator currently emits invalid SQL for expression GIN indexes.
-- The catalog is only ~52k rows at launch, so correctness and deployability
-- take precedence; add a dedicated search index later through a verified
-- production migration when query volume warrants it.
create index if not exists catalog_import_candidates_name_idx
  on catalog_import_candidates (product_name);

create index if not exists catalog_import_candidates_brand_idx
  on catalog_import_candidates (brand_name);

create index if not exists catalog_import_candidates_traceability_idx
  on catalog_import_candidates (traceability_code);

create index if not exists catalog_import_candidates_review_queue_idx
  on catalog_import_candidates (verification_status, evidence_tier, ai_enrichment_status);

create index if not exists catalog_import_candidates_canonical_key_idx
  on catalog_import_candidates (canonical_key);

commit;

-- Rollback (staging only; run manually after exporting any audit evidence):
-- drop table if exists catalog_import_candidates;
-- drop table if exists catalog_import_runs;
