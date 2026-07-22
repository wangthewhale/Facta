import assert from "node:assert/strict";
import test from "node:test";
import { extractNutritionEvidence, parseLabelNumber, transformTfda188Record, type Tfda188Record } from "./tfda188.js";

function record(overrides: Partial<Tfda188Record> = {}): Tfda188Record {
  return {
    產品分類: "零食",
    公司名稱: "測試食品股份有限公司",
    產品名稱: "測試米果",
    包裝規格: "100公克/包",
    產品追溯系統串接碼: "A-123456789-00000-0-00000000-0000000001",
    內容物標示: "白米、食鹽",
    正面外包裝照片: "https://example.com/front.jpg",
    反面外包裝照片: "",
    側面外包裝照片: "",
    營養標示圖片: "https://example.com/nutrition.jpg",
    內容物標示圖片: "https://example.com/ingredients.jpg",
    每一份量: "25公克",
    每份熱量: "120大卡",
    每份蛋白質: "2公克",
    每份脂肪: "3公克",
    每份飽和脂肪: "0.5公克",
    每份反式脂肪: "0公克",
    每份碳水化合物: "20公克",
    每份糖: "2公克",
    每份鈉: "180毫克",
    每100公克熱量: "480大卡",
    每100公克蛋白質: "8公克",
    每100公克脂肪: "12公克",
    每100公克飽和脂肪: "2公克",
    每100公克反式脂肪: "0公克",
    每100公克碳水化合物: "80公克",
    每100公克糖: "8公克",
    每100公克鈉: "720毫克",
    每100毫升熱量: "",
    每100毫升蛋白質: "",
    每100毫升脂肪: "",
    每100毫升飽和脂肪: "",
    每100毫升反式脂肪: "",
    每100毫升碳水化合物: "",
    每100毫升糖: "",
    每100毫升鈉: "",
    ...overrides,
  } as Tfda188Record;
}

test("parses label numbers without treating units as part of the value", () => {
  assert.equal(parseLabelNumber("1,250 毫克"), 1250);
  assert.equal(parseLabelNumber("0.5 公克"), 0.5);
  assert.equal(parseLabelNumber("未標示"), null);
});

test("prefers normalized per-100g evidence when enough critical nutrients exist", () => {
  const nutrition = extractNutritionEvidence(record());
  assert.equal(nutrition?.basis, "per_100g");
  assert.equal(nutrition?.servingSize, 100);
  assert.equal(nutrition?.servingSizeUnit, "g");
  assert.equal(nutrition?.sodium, 720);
});

test("imports source evidence into review staging but never marks it buy-eligible", () => {
  const candidate = transformTfda188Record(record());
  assert.equal(candidate.evidenceTier, "review_ready");
  assert.equal(candidate.nutritionAnalysisEligible, true);
  assert.equal(candidate.positiveBuyEligible, false);
  assert.equal(candidate.gtin, null);
  assert.equal(candidate.traceabilityCode.startsWith("A-"), true);
  assert.equal(candidate.qualityFlags.includes("traceability_code_is_not_gtin"), true);
});

test("queues label-image extraction when machine-readable label facts are missing", () => {
  const candidate = transformTfda188Record(record({
    內容物標示: "",
    每一份量: "",
    每份糖: "",
    每份鈉: "",
    每份飽和脂肪: "",
    每100公克糖: "",
    每100公克鈉: "",
    每100公克飽和脂肪: "",
  }));
  assert.equal(candidate.evidenceTier, "catalog_only");
  assert.equal(candidate.aiEnrichmentStatus, "queued");
  assert.equal(candidate.positiveBuyEligible, false);
});

test("rejects a record without a stable traceability code", () => {
  assert.throws(
    () => transformTfda188Record(record({ 產品追溯系統串接碼: "" })),
    /traceability code/,
  );
});
