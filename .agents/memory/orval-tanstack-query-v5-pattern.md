---
name: Orval v8 + TanStack Query v5 — query options typing
description: How to pass enabled/retry/staleTime to Orval-generated hooks without TS errors
---

## The Rule
Orval v8 generates hooks with `query?: UseQueryOptions<...>` where `UseQueryOptions` in TanStack Query v5 **requires** `queryKey`. Passing bare `{ enabled: !!id }` causes TS2741 at every call site.

**Fix:** Cast the inner object with `as any`:
```ts
useGetProduct(productId, { query: { enabled: !!productId } as any });
```

**Why:** `queryKey` is required in TanStack Query v5's `UseQueryOptions` type but Orval injects the correct key at runtime automatically. The `as any` is safe — it's a compile-time-only suppression; the hook ignores any provided `queryKey` from the options bag anyway (its own generated key always wins).

**How to apply:** Whenever you call an Orval-generated `useGet*` hook with custom query options, append `as any` to the `query: { ... }` object. Do NOT try to pass `queryKey` manually — Orval's generated options already set it.

## Additive risk levels in scoring engine
The scoring engine (scoring.ts) filters `riskLevel === "avoid"` to trigger the penalty, NOT `"high"`. Test fixtures using `"high"` will not trigger additive scoring. Use `"avoid"` in test data for negative additive scenarios.

## UserGoalsResponseActiveGoalsItem shape
Fields are prefixed with `goal*` — not bare `slug/name`:
- `goalSlug` (not `slug`)
- `goalId` (not `id`)
- `goalName`, `goalNameZh` (not `name`, `nameZh`)
- No `mealContexts` here — fetch via `useGetGoal(goalSlug)` which returns `GoalDetail` with `mealContexts[]`

## MealContextSummary field
The `meal` field (not `mealType`) distinguishes meal contexts. Use `m.meal === activeMeal`, not `m.mealType`.
