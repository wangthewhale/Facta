import assert from "node:assert/strict";
import test from "node:test";
import { isValidGtin, transformOpenFoodFactsProduct } from "./openFoodFactsCatalog.js";

test("validates common GTIN lengths and check digits", () => {
  assert.equal(isValidGtin("4710088637574"), true);
  assert.equal(isValidGtin("4710088637575"), false);
});
test("imports complete public evidence as review-ready but never buy-eligible", () => {
  const candidate = transformOpenFoodFactsProduct({
    code: "4710088637574",
    product_name_zh: "統一 PH9.0 鹼性離子水",
    brands: "統一",
    quantity: "800 ml",
    ingredients_text_zh: "水、海水",
    nutrition_data_per: "100ml",
    image_front_url: "https://images.openfoodfacts.org/front.jpg",
    image_nutrition_url: "https://images.openfoodfacts.org/nutrition.jpg",
    nutriments: {
      "energy-kcal_100g": 0,
      "proteins_100g": 0,
      "fat_100g": 0,
      "carbohydrates_100g": 0,
      "saturated-fat_100g": 0,
      "sugars_100g": 0,
      "sodium_100g": 0.014,
    },
  });

  assert.equal(candidate.evidenceTier, "review_ready");
  assert.equal(candidate.nutritionAnalysisEligible, true);
  assert.equal(candidate.positiveBuyEligible, false);
  assert.equal(candidate.gtin, "4710088637574");
});

test("quarantines nutritionally inconsistent data", () => {
  const candidate = transformOpenFoodFactsProduct({
    code: "4710088637574",
    product_name: "Test product",
    nutriments: {
      "energy-kcal_100g": 10,
      "proteins_100g": 30,
      "fat_100g": 30,
      "carbohydrates_100g": 30,
      "saturated-fat_100g": 10,
      "sugars_100g": 10,
      "sodium_100g": 0.1,
    },
  });

  assert.equal(candidate.nutritionAnalysisEligible, false);
  assert.ok(candidate.qualityFlags.includes("energy_macro_inconsistent"));
});
