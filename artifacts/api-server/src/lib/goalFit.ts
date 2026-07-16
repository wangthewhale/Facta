/**
 * FACTA Goal Fit Engine v1.0.0
 *
 * INVARIANT: This engine NEVER modifies overallScore from product_evaluations.
 * It only computes goal_fit and meal_fit from a separate versioned ruleset.
 * Same product_data_version + goal_ruleset_version = same result, always.
 */

export const GOAL_RULESET_VERSION = "1.0.0";

export type FitLevel = "great_fit" | "good_fit" | "mixed_fit" | "poor_fit" | "insufficient_data";

export interface FitReason {
  label: string;
  labelZh: string;
  positive: boolean;
}

export interface GoalFitResult {
  fitLevel: FitLevel;
  fitReasons: FitReason[];
  warnings: FitReason[];
  breakfastFit: FitLevel;
  lunchFit: FitLevel;
  dinnerFit: FitLevel;
  snackFit: FitLevel;
  goalRulesetVersion: string;
}

// ─── Thresholds: edit these to update rules, bump GOAL_RULESET_VERSION ────────

const RULES = {
  skin_health: {
    // Great fit: protein ≥ 8g/100g, fiber ≥ 2g/100g, sugar ≤ 10g/100g
    proteinMin: 8,
    fiberMin: 2,
    sugarMax: 10,
    sugarPoor: 20,
    // Insufficient: need at least protein OR fiber data
    minFields: ["protein", "dietaryFiber"],
  },
  body_fat: {
    // Per 100g or per serving thresholds
    proteinMin: 8,      // g — satiety signal
    fiberMin: 2,        // g — satiety signal
    sugarMax: 10,       // g
    sugarPoor: 20,
    calorieHighPer100: 400, // kcal — energy density concern
    proteinPerCalRatio: 0.05, // protein(g) / calories ≥ this
    // Meal-specific
    dinner: {
      sugarMax: 5,
      calorieHighPer100: 300,
    },
  },
  protein: {
    // Per serving (or per 100g if serving not available)
    proteinGreat: 15,    // g — great fit
    proteinGood: 8,      // g — good fit
    proteinPoor: 3,      // g — poor fit
    sodiumMax: 600,      // mg — no bad trade-off
    sugarMax: 15,        // g — no bad trade-off
  },
} as const;

interface NutritionSnapshot {
  protein?: number | null;
  dietaryFiber?: number | null;
  totalSugars?: number | null;
  sodium?: number | null;
  calories?: number | null;
  saturatedFat?: number | null;
  transFat?: number | null;
  servingSize?: number | null; // in grams/ml — used to scale per-serving
}

function hasSufficientData(n: NutritionSnapshot, fields: string[]): boolean {
  return fields.some(f => n[f as keyof NutritionSnapshot] != null);
}

function fitFromScore(positives: number, negatives: number, total: number): FitLevel {
  if (total === 0) return "insufficient_data";
  const ratio = positives / total;
  if (negatives === 0 && ratio === 1) return "great_fit";
  if (ratio >= 0.6 && negatives <= 1) return "good_fit";
  if (positives > negatives) return "mixed_fit";
  return "poor_fit";
}

// ─── Skin Health ──────────────────────────────────────────────────────────────

function scoreSkinHealth(n: NutritionSnapshot): { fit: FitLevel; reasons: FitReason[]; warnings: FitReason[] } {
  const r = RULES.skin_health;
  const reasons: FitReason[] = [];
  const warnings: FitReason[] = [];

  if (!hasSufficientData(n, r.minFields as unknown as string[])) {
    return { fit: "insufficient_data", reasons, warnings };
  }

  let pos = 0, neg = 0, total = 0;

  if (n.protein != null) {
    total++;
    if (n.protein >= r.proteinMin) {
      pos++;
      reasons.push({ label: `Good protein (${n.protein}g/100g)`, labelZh: `蛋白質充足（${n.protein}g/100g）`, positive: true });
    } else {
      neg++;
      reasons.push({ label: `Low protein (${n.protein}g/100g)`, labelZh: `蛋白質偏低（${n.protein}g/100g）`, positive: false });
    }
  }

  if (n.dietaryFiber != null) {
    total++;
    if (n.dietaryFiber >= r.fiberMin) {
      pos++;
      reasons.push({ label: `Good fiber (${n.dietaryFiber}g/100g)`, labelZh: `纖維充足（${n.dietaryFiber}g/100g）`, positive: true });
    } else {
      neg++;
      reasons.push({ label: `Low fiber (${n.dietaryFiber}g/100g)`, labelZh: `纖維偏低（${n.dietaryFiber}g/100g）`, positive: false });
    }
  }

  if (n.totalSugars != null) {
    total++;
    if (n.totalSugars <= r.sugarMax) {
      pos++;
      reasons.push({ label: `Low added sugars (${n.totalSugars}g)`, labelZh: `低糖（${n.totalSugars}g）`, positive: true });
    } else if (n.totalSugars >= r.sugarPoor) {
      neg++;
      warnings.push({ label: `High sugar — limit for skin health`, labelZh: `高糖，對皮膚健康目標需留意`, positive: false });
    } else {
      neg++;
      reasons.push({ label: `Moderate sugars (${n.totalSugars}g)`, labelZh: `含糖量中等（${n.totalSugars}g）`, positive: false });
    }
  }

  return { fit: fitFromScore(pos, neg, total), reasons, warnings };
}

// ─── Body Fat / Weight Management ────────────────────────────────────────────

function scoreBodyFat(n: NutritionSnapshot, meal?: string): { fit: FitLevel; reasons: FitReason[]; warnings: FitReason[] } {
  const r = RULES.body_fat;
  const thresholds = meal === "dinner" ? { ...r, ...r.dinner } : r;
  const reasons: FitReason[] = [];
  const warnings: FitReason[] = [];

  if (n.protein == null && n.dietaryFiber == null && n.totalSugars == null && n.calories == null) {
    return { fit: "insufficient_data", reasons, warnings };
  }

  let pos = 0, neg = 0, total = 0;

  if (n.protein != null) {
    total++;
    if (n.protein >= thresholds.proteinMin) {
      pos++;
      reasons.push({ label: `Protein supports satiety (${n.protein}g)`, labelZh: `蛋白質有助飽足感（${n.protein}g）`, positive: true });
    } else {
      neg++;
      reasons.push({ label: `Low protein — less filling`, labelZh: `蛋白質偏低，飽足感較低`, positive: false });
    }
  }

  if (n.dietaryFiber != null) {
    total++;
    if (n.dietaryFiber >= thresholds.fiberMin) {
      pos++;
      reasons.push({ label: `Good fiber for satiety (${n.dietaryFiber}g)`, labelZh: `纖維充足，有助飽足（${n.dietaryFiber}g）`, positive: true });
    } else {
      neg++;
      reasons.push({ label: `Low fiber`, labelZh: `纖維偏低`, positive: false });
    }
  }

  if (n.totalSugars != null) {
    total++;
    if (n.totalSugars <= thresholds.sugarMax) {
      pos++;
      reasons.push({ label: `Low sugars (${n.totalSugars}g)`, labelZh: `低糖（${n.totalSugars}g）`, positive: true });
    } else if (n.totalSugars >= thresholds.sugarPoor) {
      neg++;
      warnings.push({ label: `High sugar — not ideal for body fat goal`, labelZh: `高糖，不利降低體脂目標`, positive: false });
    } else {
      neg++;
      reasons.push({ label: `Moderate sugars`, labelZh: `含糖量中等`, positive: false });
    }
  }

  if (n.calories != null) {
    total++;
    if (n.calories <= thresholds.calorieHighPer100) {
      pos++;
      reasons.push({ label: `Moderate energy density (${n.calories}kcal/100g)`, labelZh: `能量密度適中（${n.calories}kcal/100g）`, positive: true });
    } else {
      neg++;
      reasons.push({ label: `High energy density (${n.calories}kcal/100g)`, labelZh: `能量密度較高（${n.calories}kcal/100g）`, positive: false });
    }
  }

  return { fit: fitFromScore(pos, neg, total), reasons, warnings };
}

// ─── Protein Intake ───────────────────────────────────────────────────────────

function scoreProtein(n: NutritionSnapshot): { fit: FitLevel; reasons: FitReason[]; warnings: FitReason[] } {
  const r = RULES.protein;
  const reasons: FitReason[] = [];
  const warnings: FitReason[] = [];

  if (n.protein == null) {
    return { fit: "insufficient_data", reasons, warnings };
  }

  let fit: FitLevel;
  if (n.protein >= r.proteinGreat) {
    fit = "great_fit";
    reasons.push({ label: `High protein (${n.protein}g)`, labelZh: `高蛋白（${n.protein}g）`, positive: true });
  } else if (n.protein >= r.proteinGood) {
    fit = "good_fit";
    reasons.push({ label: `Good protein (${n.protein}g)`, labelZh: `蛋白質尚可（${n.protein}g）`, positive: true });
  } else if (n.protein >= r.proteinPoor) {
    fit = "mixed_fit";
    reasons.push({ label: `Modest protein (${n.protein}g)`, labelZh: `蛋白質偏少（${n.protein}g）`, positive: false });
  } else {
    fit = "poor_fit";
    reasons.push({ label: `Very low protein (${n.protein}g)`, labelZh: `蛋白質很低（${n.protein}g）`, positive: false });
  }

  // Trade-off warnings — downgrade fit if sodium or sugar is very high
  if (n.sodium != null && n.sodium > r.sodiumMax) {
    if (fit === "great_fit") fit = "good_fit";
    warnings.push({ label: `High sodium — trade-off with protein goal`, labelZh: `鈉含量偏高，搭配蛋白質目標需留意`, positive: false });
  }
  if (n.totalSugars != null && n.totalSugars > r.sugarMax) {
    if (fit === "great_fit") fit = "good_fit";
    warnings.push({ label: `High sugars — trade-off`, labelZh: `含糖量偏高，需搭配留意`, positive: false });
  }

  return { fit, reasons, warnings };
}

// ─── Meal Fit helpers ─────────────────────────────────────────────────────────

function mealAdjust(baseFit: FitLevel, meal: string, goalSlug: string, n: NutritionSnapshot): FitLevel {
  // Snack: high calorie density is a downgrade for body fat goal
  if (goalSlug === "body_fat" && meal === "snack" && n.calories != null && n.calories > 200) {
    if (baseFit === "great_fit") return "good_fit";
    if (baseFit === "good_fit") return "mixed_fit";
  }
  // Dinner: for skin health, high sugar is worse at dinner
  if (goalSlug === "skin_health" && meal === "dinner" && n.totalSugars != null && n.totalSugars > 15) {
    if (baseFit === "great_fit") return "good_fit";
  }
  return baseFit;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function calculateGoalFit(
  goalSlug: string,
  nutrition: NutritionSnapshot,
): GoalFitResult {
  let base: { fit: FitLevel; reasons: FitReason[]; warnings: FitReason[] };

  switch (goalSlug) {
    case "skin_health":
      base = scoreSkinHealth(nutrition);
      break;
    case "body_fat":
      base = scoreBodyFat(nutrition);
      break;
    case "protein":
      base = scoreProtein(nutrition);
      break;
    default:
      return {
        fitLevel: "insufficient_data",
        fitReasons: [],
        warnings: [{ label: "Goal not yet supported", labelZh: "此目標尚未支援", positive: false }],
        breakfastFit: "insufficient_data",
        lunchFit: "insufficient_data",
        dinnerFit: "insufficient_data",
        snackFit: "insufficient_data",
        goalRulesetVersion: GOAL_RULESET_VERSION,
      };
  }

  const scoreMealFn = goalSlug === "body_fat"
    ? (meal: string) => {
        const { fit } = scoreBodyFat(nutrition, meal);
        return mealAdjust(fit, meal, goalSlug, nutrition);
      }
    : (meal: string) => mealAdjust(base.fit, meal, goalSlug, nutrition);

  return {
    fitLevel: base.fit,
    fitReasons: base.reasons,
    warnings: base.warnings,
    breakfastFit: scoreMealFn("breakfast"),
    lunchFit: scoreMealFn("lunch"),
    dinnerFit: scoreMealFn("dinner"),
    snackFit: scoreMealFn("snack"),
    goalRulesetVersion: GOAL_RULESET_VERSION,
  };
}
