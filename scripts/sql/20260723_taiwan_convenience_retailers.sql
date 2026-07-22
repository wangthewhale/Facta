-- FACTA Taiwan convenience-store identity seed.
--
-- Idempotently makes all four major chains available to product submissions,
-- search filters and retailer-level food-safety matching. This does not attach
-- any existing product to a retailer and does not create a health conclusion.

begin;

insert into retailers (name, slug, country)
values
  ('7-ELEVEN', '7eleven', 'TW'),
  ('全家 FamilyMart', 'family-mart', 'TW'),
  ('萊爾富 Hi-Life', 'hi-life', 'TW'),
  ('OKmart', 'ok-mart', 'TW')
on conflict (slug) do update set
  name = excluded.name,
  country = excluded.country;

commit;

-- Safe rollback guidance:
-- 1. Restore legacy display names if desired:
--      update retailers set name = '全家' where slug = 'family-mart';
-- 2. Delete hi-life / ok-mart only when no product_retailer_prices or
--    curated_collections rows reference them. Once referenced, retaining the
--    identity row is safer than breaking historical product evidence.
