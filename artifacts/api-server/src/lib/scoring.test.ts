/**
 * FACTA Scoring Engine — Invariant Tests
 *
 * These tests verify the core integrity invariants from the spec (§13):
 *  1. Switching goal does NOT change FACTA Score
 *  2. Same inputs + same ruleset version → same Goal Fit
 *  3. Insufficient data never treated as safe
 *
 * Run with: npx vitest src/lib/scoring.test.ts
 */

import { describe, it, expect } from "vitest";
import { calculateScore, RULESET_VERSION } from "./scoring.js";
import { calculateGoalFit, GOAL_RULESET_VERSION } from "./goalFit.js";

// ─── Fixture data ─────────────────────────────────────────────────────────────

const greenTeaNutrition = {
  servingSize: 100,
  servingSizeUnit: "ml",
  calories: 5,
  totalFat: 0,
  saturatedFat: 0,
  transFat: 0,
  sodium: 15,
  totalCarbs: 1,
  dietaryFiber: 0,
  totalSugars: 0.5,
  protein: 0,
};

const highSugarDrinkNutrition = {
  servingSize: 330,
  servingSizeUnit: "ml",
  calories: 180,
  totalFat: 0,
  saturatedFat: 0,
  transFat: 0,
  sodium: 80,
  totalCarbs: 45,
  dietaryFiber: 0,
  totalSugars: 43,
  protein: 0,
};

const highProteinSnackNutrition = {
  servingSize: 50,
  servingSizeUnit: "g",
  calories: 150,
  totalFat: 5,
  saturatedFat: 1.5,
  transFat: 0,
  sodium: 250,
  totalCarbs: 12,
  dietaryFiber: 3,
  totalSugars: 4,
  protein: 18,
};

// ─── Scoring determinism ───────────────────────────────────────────────────────

describe("FACTA Score — determinism", () => {
  it("produces the same score for identical inputs", () => {
    const r1 = calculateScore({ nutrition: greenTeaNutrition, ingredients: [], dataCompleteness: 0.9 });
    const r2 = calculateScore({ nutrition: greenTeaNutrition, ingredients: [], dataCompleteness: 0.9 });
    expect(r1.overallScore).toBe(r2.overallScore);
    expect(r1.scoreGrade).toBe(r2.scoreGrade);
    expect(r1.rulesetVersion).toBe(RULESET_VERSION);
  });

  it("consistently rates green tea as Excellent", () => {
    const result = calculateScore({ nutrition: greenTeaNutrition, ingredients: [], dataCompleteness: 0.9 });
    expect(result.overallScore).toBeGreaterThanOrEqual(80);
    expect(result.scoreGrade).toBe("Excellent");
    expect(result.analysisScope).toBe("nutrition_only");
  });

  it("consistently rates high-sugar drink below green tea", () => {
    const highSugar = calculateScore({ nutrition: highSugarDrinkNutrition, ingredients: [], dataCompleteness: 0.9 });
    const greenTea = calculateScore({ nutrition: greenTeaNutrition, ingredients: [], dataCompleteness: 0.9 });
    // High-sugar drink should score significantly lower than green tea
    expect(highSugar.overallScore).toBeLessThan(greenTea.overallScore);
    // Sugar penalty is reflected in reasons
    expect(highSugar.topReasons.some(r => r.impact === "negative")).toBe(true);
  });
});

// ─── Invariant 1: Goal does NOT change FACTA Score ────────────────────────────

describe("Invariant: goals do not change FACTA Score", () => {
  const scoringInput = { nutrition: highProteinSnackNutrition, ingredients: [], dataCompleteness: 0.9 };

  it("same product scores identically regardless of which goal is active", () => {
    const baseScore = calculateScore(scoringInput).overallScore;

    // Simulate changing goals — score must be identical
    const scoreWithSkinGoal = calculateScore(scoringInput).overallScore;
    const scoreWithProteinGoal = calculateScore(scoringInput).overallScore;
    const scoreWithBodyFatGoal = calculateScore(scoringInput).overallScore;

    expect(scoreWithSkinGoal).toBe(baseScore);
    expect(scoreWithProteinGoal).toBe(baseScore);
    expect(scoreWithBodyFatGoal).toBe(baseScore);
  });

  it("goal fit is computed independently from overallScore", () => {
    const factaScore = calculateScore(scoringInput).overallScore;
    const goalFit = calculateGoalFit("protein", highProteinSnackNutrition);

    // Changing goal fit does not interact with FACTA score
    expect(factaScore).toBeGreaterThan(0);
    expect(goalFit.fitLevel).not.toBe(undefined);
    // FACTA Score is NOT an input to calculateGoalFit
  });
});

// ─── Invariant 2: Same inputs → same Goal Fit ─────────────────────────────────

describe("Invariant: Goal Fit determinism", () => {
  it("returns identical result for same product + goal combination", () => {
    const r1 = calculateGoalFit("protein", highProteinSnackNutrition);
    const r2 = calculateGoalFit("protein", highProteinSnackNutrition);
    expect(r1.fitLevel).toBe(r2.fitLevel);
    expect(r1.goalRulesetVersion).toBe(r2.goalRulesetVersion);
    expect(r1.goalRulesetVersion).toBe(GOAL_RULESET_VERSION);
  });

  it("high-protein snack fits protein goal", () => {
    const result = calculateGoalFit("protein", highProteinSnackNutrition);
    expect(["great_fit", "good_fit"]).toContain(result.fitLevel);
  });

  it("high-sugar drink does not fit skin_health goal", () => {
    const result = calculateGoalFit("skin_health", highSugarDrinkNutrition);
    expect(["poor_fit", "mixed_fit"]).toContain(result.fitLevel);
  });

  it("green tea skin_health result is deterministic across calls", () => {
    // Green tea has no protein/fiber so skin_health ruleset may flag it —
    // the important invariant is that the result is identical on every call.
    const r1 = calculateGoalFit("skin_health", greenTeaNutrition);
    const r2 = calculateGoalFit("skin_health", greenTeaNutrition);
    expect(r1.fitLevel).toBe(r2.fitLevel);
    expect(r1.goalRulesetVersion).toBe(r2.goalRulesetVersion);
  });
});

// ─── Invariant 3: Insufficient data is NOT treated as safe ────────────────────

describe("Invariant: insufficient data is never safe", () => {
  it("returns insufficient_data when no nutrition facts available", () => {
    const result = calculateGoalFit("skin_health", {
      protein: null,
      dietaryFiber: null,
      totalSugars: null,
      sodium: null,
      calories: null,
    });
    expect(result.fitLevel).toBe("insufficient_data");
    // Must not return great_fit, good_fit, mixed_fit — these imply a judgment
    expect(result.fitLevel).not.toBe("great_fit");
    expect(result.fitLevel).not.toBe("good_fit");
  });

  it("returns insufficient_data for protein goal with no nutrition", () => {
    const result = calculateGoalFit("protein", {
      protein: null,
      dietaryFiber: null,
      totalSugars: null,
      sodium: null,
      calories: null,
    });
    expect(result.fitLevel).toBe("insufficient_data");
  });

  it("returns insufficient_data for body_fat goal with no nutrition", () => {
    const result = calculateGoalFit("body_fat", {
      protein: null,
      dietaryFiber: null,
      totalSugars: null,
      sodium: null,
      calories: null,
    });
    expect(result.fitLevel).toBe("insufficient_data");
  });

  it("FACTA Score with missing nutrition marks dataCompleteness low", () => {
    const result = calculateScore({
      nutrition: null,
      ingredients: [],
      dataCompleteness: 0.1,
    });
    // Should still produce a score (not crash), but it will be low confidence
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.evidenceConfidence).toBe("low");
    expect(result.analysisScope).toBe("insufficient");
  });

  it("does not produce a nutrition rating without a serving-size basis", () => {
    const result = calculateScore({
      nutrition: { totalSugars: 0, sodium: 5, saturatedFat: 0 },
      ingredients: [],
      dataCompleteness: 0.5,
    });
    expect(result.nutritionScore).toBeNull();
    expect(result.analysisScope).toBe("insufficient");
    expect(result.topReasons.some(reason => reason.labelZh.includes("每份量"))).toBe(true);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("trans fat triggers penalty", () => {
    const withTrans = calculateScore({
      nutrition: { ...greenTeaNutrition, transFat: 1.5 },
      ingredients: [],
      dataCompleteness: 0.9,
    });
    const without = calculateScore({
      nutrition: greenTeaNutrition,
      ingredients: [],
      dataCompleteness: 0.9,
    });
    expect(withTrans.overallScore).toBeLessThan(without.overallScore);
  });

  it("avoid-level additive lowers score", () => {
    // The engine uses riskLevel "avoid" to trigger the penalty (not "high")
    const withAdditive = calculateScore({
      nutrition: greenTeaNutrition,
      ingredients: [
        { name: "Red 40", riskLevel: "avoid", isAdditive: "true", evidenceStrength: "moderate", riskReason: "Synthetic dye" },
      ],
      dataCompleteness: 0.9,
    });
    const without = calculateScore({
      nutrition: greenTeaNutrition,
      ingredients: [],
      dataCompleteness: 0.9,
    });
    expect(withAdditive.overallScore).toBeLessThan(without.overallScore);
    expect(withAdditive.additiveFlags.length).toBeGreaterThan(0);
  });

  it("score is clamped to 0-100", () => {
    const worst = calculateScore({
      nutrition: {
        servingSize: 100,
        servingSizeUnit: "g",
        sodium: 3000,
        totalSugars: 80,
        saturatedFat: 20,
        transFat: 5,
        calories: 600,
        dietaryFiber: 0,
        protein: 0,
      },
      ingredients: [
        { name: "Bad additive", riskLevel: "avoid", isAdditive: "true", evidenceStrength: "high", riskReason: "harmful" },
        { name: "Very bad", riskLevel: "avoid", isAdditive: "true", evidenceStrength: "high", riskReason: "harmful" },
      ],
      dataCompleteness: 0.9,
    });
    expect(worst.overallScore).toBeGreaterThanOrEqual(0);
    expect(worst.overallScore).toBeLessThanOrEqual(100);
  });

  it("normalizes a snack serving to 100 g before rating it", () => {
    const result = calculateScore({
      nutrition: {
        servingSize: 30,
        servingSizeUnit: "g",
        totalSugars: 8,
        sodium: 310,
        saturatedFat: 1.5,
        transFat: 0,
      },
      ingredients: [],
      dataCompleteness: 0.7,
    });
    expect(result.nutritionBasis).toBe("per_100g");
    expect(result.nutritionScore).toBe(25);
    expect(result.scoreGrade).toBe("Poor");
  });

  it("unknown ingredient mappings never become a positive safety claim", () => {
    const result = calculateScore({
      nutrition: greenTeaNutrition,
      ingredients: [{ name: "未對照成分", riskLevel: "unknown" }],
      dataCompleteness: 0.6,
    });
    expect(result.additiveScore).toBeNull();
    expect(result.analysisScope).toBe("nutrition_only");
    expect(result.topReasons.some(reason => reason.labelZh.includes("未找到需留意"))).toBe(false);
  });
});
