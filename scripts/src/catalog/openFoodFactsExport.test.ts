import assert from "node:assert/strict";
import test from "node:test";
import { transformOpenFoodFactsExportLine } from "../open-food-facts-export-import.js";
import { transformOpenFoodFactsProduct } from "./openFoodFactsCatalog.js";

const headers = [
  "code", "product_name", "brands", "categories", "quantity", "countries_tags",
  "ingredients_text", "image_url", "nutrition_data_per", "energy-kcal_100g",
  "proteins_100g", "fat_100g", "saturated-fat_100g", "trans-fat_100g",
  "carbohydrates_100g", "sugars_100g", "sodium_100g", "last_modified_t",
];
const headerIndex = new Map(headers.map((name, index) => [name, index]));

test("extracts Taiwan rows from the official daily export without auto-approving them", () => {
  const row = [
    "4710088637574", "統一 PH9.0 鹼性離子水", "統一", "飲料", "800 ml",
    "en:taiwan,en:france", "水、海水", "https://images.openfoodfacts.org/front.jpg",
    "100ml", "0", "0", "0", "0", "0", "0", "0", "0.014", "1784736000",
  ].join("\t");
  const product = transformOpenFoodFactsExportLine(headerIndex, row);
  assert.ok(product);
  const candidate = transformOpenFoodFactsProduct(product);
  assert.equal(candidate.gtin, "4710088637574");
  assert.equal(candidate.productName, "統一 PH9.0 鹼性離子水");
  assert.equal(candidate.nutritionRaw.normalized?.basis, "per_100ml");
  assert.equal(candidate.positiveBuyEligible, false);
});

test("ignores export rows that are not tagged for Taiwan", () => {
  const row = ["4710088637574", "Water", "Brand", "Beverages", "800 ml", "en:france"].join("\t");
  assert.equal(transformOpenFoodFactsExportLine(headerIndex, row), null);
});
