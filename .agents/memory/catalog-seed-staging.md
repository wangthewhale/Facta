---
name: Catalog seed staging table
description: facta_catalog_seed staging table rules — unverified retailer catalog data, no scoring until label verification.
---
The `facta_catalog_seed` table (1,307 rows from 7-ELEVEN / FamilyMart / Costco TW / Uni-Prosperity, imported 2026-07-16) is a **staging** table, separate from the canonical `products` tables.

**Rules from the data provider (must respect):**
- `source_product_id` is a retailer catalog ID, NOT a GTIN; `barcode_gtin` is blank by design.
- Never generate/display FACTA scores for rows with `verification_status='catalog_unverified'` or `label_data_status='missing_label_data'`.
- In search UI, such rows need a "Catalog data · label verification needed" badge + CTA to photograph front/barcode/ingredients/nutrition.
- Never infer ingredients/allergens/nutrition from product names.
- Keep retailer rows separate until a verified GTIN or human-reviewed link connects them to a canonical product.
- Upserts key on `facta_seed_id`; never overwrite non-empty verified label fields with empty seed values (loader uses COALESCE for barcode/ingredients/allergen/nutrition columns).

**Why:** unverified web-catalog data must not contaminate the verified scoring pipeline.
**How to apply:** any feature that surfaces catalog-seed rows (search, browse) must route users into the OCR/photo verification flow before scoring.
