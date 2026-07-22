import { describe, expect, it } from "vitest";
import { matchSafetyAlertItem } from "./safetyAlertMatching.js";

const familyMartProduct = {
  barcode: "2012345004245",
  productNames: ["雞蛋沙拉三明治"],
  businessNames: ["FamilyMart", "全家", "全家便利商店股份有限公司"],
};

describe("food safety alert matching", () => {
  it("marks the exact named SKU as affected", () => {
    const result = matchSafetyAlertItem(familyMartProduct, {
      businessName: "全家便利商店",
      matchKeywords: ["全家"],
      productExamples: ["雞蛋沙拉三明治", "鮪魚飯糰"],
    });
    expect(result?.matchScope).toBe("exact_product");
    expect(result?.affectsProduct).toBe(true);
  });

  it("keeps a retailer-level incident uncertain when this SKU is not named", () => {
    const result = matchSafetyAlertItem(familyMartProduct, {
      businessName: "全家便利商店",
      matchKeywords: ["全家", "FamilyMart"],
      productExamples: ["珍保玉筍", "素食沙茶醬"],
    });
    expect(result?.matchScope).toBe("business");
    expect(result?.affectsProduct).toBeNull();
    expect(result?.statusZh).toContain("沒有證據證明");
  });

  it("does not match an unrelated retailer", () => {
    const result = matchSafetyAlertItem(familyMartProduct, {
      businessName: "萊爾富國際股份有限公司",
      matchKeywords: ["萊爾富", "Hi-Life"],
      productExamples: ["熱狗麵包"],
    });
    expect(result).toBeNull();
  });

  it("does not treat the same generic product name at another chain as the same SKU", () => {
    const result = matchSafetyAlertItem(familyMartProduct, {
      businessName: "統一超商股份有限公司",
      matchKeywords: ["7-ELEVEN", "統一超商"],
      productExamples: ["雞蛋沙拉三明治"],
    });
    expect(result).toBeNull();
  });

  it("can match an explicitly published barcode", () => {
    const result = matchSafetyAlertItem(familyMartProduct, {
      businessName: "上游供應商",
      matchKeywords: [],
      productExamples: ["回收條碼 2012345004245，批號 A1"],
    });
    expect(result?.affectsProduct).toBe(true);
  });
});
