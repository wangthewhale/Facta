-- FACTA household decision outcome ledger.
--
-- This table never changes product scores or verification status. It stores
-- the action shown to a household and the choice made afterward so FACTA can
-- measure whether recommendations and alternatives are genuinely useful.

begin;

create table if not exists decision_outcomes (
  id serial primary key,
  client_event_id text not null,
  session_id text not null,
  product_id integer not null,
  evaluation_id integer not null,
  recommendation_code text not null,
  outcome_code text not null,
  selected_alternative_product_id integer,
  reason_code text,
  note text,
  source text not null default 'report',
  created_at timestamptz not null default now(),
  constraint decision_outcomes_recommendation_check
    check (recommendation_code in ('buy', 'limit', 'swap', 'complete_data')),
  constraint decision_outcomes_outcome_check
    check (outcome_code in (
      'bought', 'skipped', 'limited', 'kept', 'swapped',
      'could_not_find', 'will_complete_data'
    )),
  constraint decision_outcomes_reason_check
    check (reason_code is null or reason_code in (
      'health', 'allergen', 'ingredients', 'price', 'availability',
      'taste', 'family_preference', 'not_concerned', 'other'
    )),
  constraint decision_outcomes_alternative_check
    check (
      (outcome_code = 'swapped' and selected_alternative_product_id is not null)
      or
      (outcome_code <> 'swapped' and selected_alternative_product_id is null)
    )
);

create unique index if not exists decision_outcomes_client_event_idx
  on decision_outcomes (client_event_id);

create index if not exists decision_outcomes_session_created_idx
  on decision_outcomes (session_id, created_at desc);

create index if not exists decision_outcomes_product_idx
  on decision_outcomes (product_id);

commit;

-- Rollback (manual, destructive):
-- drop table if exists decision_outcomes;
