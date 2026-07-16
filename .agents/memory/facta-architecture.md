---
name: FACTA Architecture
description: Core architecture, scoring engine design, and data model patterns for the FACTA food intelligence app.
---

# FACTA Architecture

## Stack
- Frontend: React + Vite at `artifacts/facta` (previewPath `/`, port from `$PORT`)
- Backend: Express 5 at `artifacts/api-server` (port 8080, mounted at `/api`)
- DB: PostgreSQL + Drizzle ORM in `lib/db`
- API contract: OpenAPI spec in `lib/api-spec/openapi.yaml`, codegen via Orval into `lib/api-client-react` and `lib/api-zod`
- AI: Replit-managed OpenAI via `@workspace/integrations-openai-ai-server` (env: `AI_INTEGRATIONS_OPENAI_*`)

## Scoring Engine
- Deterministic and rule-based only — `artifacts/api-server/src/lib/scoring.ts`
- AI (GPT) only used for OCR text extraction in `/submissions/ocr` endpoint
- Scores cached in `product_evaluations` table; recomputed if `ruleset_version` changes
- Current ruleset: v1.0.0 — nutrition weight 0.6, additive weight 0.4

## Codegen Orval Collision Pattern
- Orval generates `<OperationIdPascal>Params` for path params; if the same operation also has query params, Orval generates a second same-named type causing TS2308 re-export collision.
- **Fix**: Remove query params from operations that also have path params. Pass user_session/retailer_id via session or headers instead.
- Fixed operations: `getProductEvaluation` (removed `user_session` query param), `getAlternatives` (removed `retailer_id`, `user_session` query params).

## i18n
- Translation context at `artifacts/facta/src/lib/i18n.tsx` (not `src/components/i18n`)
- `useTranslation` hook + `I18nProvider` wraps entire app
- zh-TW primary, en secondary, toggle stored in localStorage
- Import path from `components/` must be `../lib/i18n`

## DB Schema Notes
- Text columns used for booleans (`is_primary`, `is_available`, `is_additive`, `same_retailer`) — use `=== "true"` to check
- `product_evaluations.top_reasons` and `additive_flags` are JSONB arrays
- `scoring_rulesets` table tracks active ruleset version — bump `version` to invalidate cached evaluations

## Why: Scoring is deterministic
Same input + ruleset version must always produce the same score. AI free-form scoring is explicitly excluded — it must never influence `overallScore`, `nutritionScore`, or `additiveScore`.
