---
name: FACTA conversion UX decisions
description: Durable decisions from the 2026-07 conversion-focused UX overhaul.
---
- Submit flow is photo-first: ingredients photo → OCR auto-detects name/brand → user confirms/edits → createSubmission → confirmOcr → finalize. Do not reintroduce a name/barcode form as step 1.
- Home sample report uses verified product id 6 (愛之味麥仔茶); component hides itself if the product is not `verified`.
- Paid offer: 家庭食品健檢 NT$299 one-time (list NT$499). Checkout URL comes only from `VITE_FACTA_CHECKOUT_URL`; when unset, buttons fall back to /family-check details page + dev-only notice. No fake payment flows.
- **Why:** user spec forbids fake payment success and fabricated numbers (no user counts/reviews); stats grid was removed from home deliberately — don't re-add small numbers.
- Analytics: `track()` in src/lib/analytics.ts posts to optional `window.factaAnalytics`; must never throw.
- API client errors are `ApiError` with `.status`; scan page treats only 404 as "unknown barcode", other errors get a retry state.
