import assert from "node:assert/strict";
import test from "node:test";
import { parseSevenElevenCatalogXml, summarizeSevenElevenCatalog } from "./sevenElevenTaiwan.js";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<BD>
  <Item><name>海鹽御飯糰 &amp; 蛋</name><kcal>220</kcal><price>39</price><image>images/rice_1.png</image><content>測試</content><new>True</new></Item>
  <Item><name>沒有熱量的新品</name><kcal></kcal><price>49元</price><image></image><content></content><new></new></Item>
</BD>`;

test("parses 7-ELEVEN official catalog without treating calories as a score-ready nutrition panel", () => {
  const candidates = parseSevenElevenCatalogXml(FIXTURE, 1);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.productName, "海鹽御飯糰 & 蛋");
  assert.equal(candidates[0]?.nutritionRaw.caloriesPerItem, 220);
  assert.equal(candidates[0]?.nutritionAnalysisEligible, false);
  assert.equal(candidates[0]?.gtin, null);
  assert.match(candidates[0]?.imageUrls[0] ?? "", /freshfoods\/1_Ricerolls\/images\/rice_1\.png/);
  assert.ok(candidates[1]?.qualityFlags.includes("missing_product_image"));
});

test("reports coverage rates as observable fields", () => {
  const summary = summarizeSevenElevenCatalog(parseSevenElevenCatalogXml(FIXTURE, 1));
  assert.deepEqual(summary, {
    accepted: 2,
    uniqueNames: 2,
    duplicateNameRows: 0,
    withImages: 1,
    withCalories: 1,
    withPrices: 2,
    withGtins: 0,
    nutritionAnalysisEligible: 0,
  });
});
