import { describe, expect, it } from "vitest";
import {
  isRestrictedCirculationBarcode,
  resolveConvenienceRetailer,
} from "./convenienceRetailer.js";

describe("Taiwan convenience retailer identity", () => {
  it.each([
    ["統一超商股份有限公司", "7eleven"],
    ["FamilyMart", "family-mart"],
    ["萊爾富國際股份有限公司", "hi-life"],
    ["來來超商股份有限公司", "ok-mart"],
  ])("maps official company and brand aliases: %s", (brandName, slug) => {
    const result = resolveConvenienceRetailer({ brandNames: [brandName] });
    expect(result.retailerSlug).toBe(slug);
    expect(result.retailerConfidence).toBe("strong");
    expect(result.retailerEvidence).toBe("package_or_brand");
  });

  it("treats an explicit saved retailer relation as confirmed", () => {
    const result = resolveConvenienceRetailer({ explicitRetailerSlug: "hi-life" });
    expect(result.retailerName).toBe("萊爾富 Hi-Life");
    expect(result.retailerConfidence).toBe("confirmed");
    expect(result.retailerEvidence).toBe("retailer_record");
  });

  it("recognizes an official retailer catalog domain", () => {
    const result = resolveConvenienceRetailer({
      sourceUrls: ["https://www.okmart.com.tw/product/example"],
    });
    expect(result.retailerSlug).toBe("ok-mart");
    expect(result.retailerConfidence).toBe("confirmed");
    expect(result.retailerEvidence).toBe("official_catalog");
  });

  it("does not turn a general brand containing 統一 into 7-ELEVEN", () => {
    expect(resolveConvenienceRetailer({ brandNames: ["統一企業"] }).retailerSlug).toBeNull();
    expect(resolveConvenienceRetailer({ productNames: ["全家人都愛的牛奶"] }).retailerSlug).toBeNull();
    expect(resolveConvenienceRetailer({ packageText: ["OK，今天吃清淡一點"] }).retailerSlug).toBeNull();
  });

  it("labels restricted-circulation numbers without guessing a retailer", () => {
    expect(isRestrictedCirculationBarcode("2012345004245")).toBe(true);
    const result = resolveConvenienceRetailer({ barcode: "2012345004245" });
    expect(result.retailerSlug).toBeNull();
    expect(result.retailerEvidence).toBe("restricted_barcode_only");
    expect(result.retailerReasonZh).toContain("不能只靠前綴猜店家");
  });

  it("does not assign an ordinary GTIN to the shop where it may be sold", () => {
    const result = resolveConvenienceRetailer({ barcode: "4710088637574" });
    expect(result.retailerSlug).toBeNull();
    expect(result.retailerEvidence).toBe("unknown");
  });
});
