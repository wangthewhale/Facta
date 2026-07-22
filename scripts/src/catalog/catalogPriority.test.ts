import assert from "node:assert/strict";
import test from "node:test";
import { calculateCatalogPriority } from "./catalogPriority.js";

test("prioritizes high-demand candidates that are close to verification", () => {
  const ready = calculateCatalogPriority({
    evidenceTier: "review_ready",
    scanCount: 8,
    submissionCount: 2,
    imageCount: 2,
    hasNutrition: true,
    hasIngredients: true,
    daysSinceUpdate: 1,
  });
  const empty = calculateCatalogPriority({
    evidenceTier: "catalog_only",
    scanCount: 1,
    submissionCount: 0,
    imageCount: 0,
    hasNutrition: false,
    hasIngredients: false,
    daysSinceUpdate: 30,
  });

  assert.ok(ready.score > empty.score);
  assert.equal(ready.lane, "human_verify");
});
test("routes image-backed incomplete records to AI extraction", () => {
  const result = calculateCatalogPriority({
    evidenceTier: "catalog_only",
    scanCount: 4,
    submissionCount: 0,
    imageCount: 2,
    hasNutrition: false,
    hasIngredients: false,
    daysSinceUpdate: 2,
  });
  assert.equal(result.lane, "ai_extract");
  assert.ok(result.reasons.some(reason => reason.includes("AI")));
});
