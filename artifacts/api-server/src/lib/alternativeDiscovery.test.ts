import { describe, expect, it } from "vitest";
import {
  buildShoppingLinks,
  compareCandidateNutrition,
  extractDiscoveryTerms,
  nutritionInputFromRaw,
  sanitizeCommerceCandidates,
} from "./alternativeDiscovery.js";

describe("alternative discovery", () => {
  it("extracts an explainable product-family term from a noisy supplement name", () => {
    expect(extractDiscoveryTerms({
      productName: "MIHONG高效益生菌(優格風味)",
      brandName: "MIHONG",
      categoryName: "營養食品製品",
    })).toContain("益生菌");
  });

  it("uses the same per-100 basis to identify a cautious nutrition improvement", () => {
    const comparison = compareCandidateNutrition(
      { servingSize: 20, servingSizeUnit: "g", totalSugars: 8, sodium: 120, saturatedFat: 2 },
      { servingSize: 10, servingSizeUnit: "g", totalSugars: 2, sodium: 30, saturatedFat: 0.5 },
    );

    expect(comparison.comparisonStatus).toBe("nutrition_prefilter");
    expect(comparison.preliminaryBetter).toBe(true);
    expect(comparison.reasonsZh.some(reason => reason.includes("糖少"))).toBe(true);
  });

  it("does not compare solid and liquid labels", () => {
    const comparison = compareCandidateNutrition(
      { servingSize: 100, servingSizeUnit: "g", totalSugars: 12, sodium: 200 },
      { servingSize: 100, servingSizeUnit: "ml", totalSugars: 2, sodium: 30 },
    );
    expect(comparison.comparisonStatus).toBe("identity_only");
    expect(comparison.preliminaryBetter).toBe(false);
  });

  it("reads normalized nutrition from imported source JSON", () => {
    expect(nutritionInputFromRaw({
      normalized: {
        servingSize: 100,
        servingSizeUnit: "g",
        totalSugars: 3,
        sodium: 90,
        saturatedFat: null,
      },
    })).toMatchObject({ servingSize: 100, servingSizeUnit: "g", totalSugars: 3, sodium: 90 });
  });

  it("keeps inspectable Taiwan commerce listings and rejects unknown domains", () => {
    const candidates = sanitizeCommerceCandidates([
      {
        name: "測試益生菌",
        retailerName: "momo",
        productUrl: "https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=123",
        priceNtd: 699,
      },
      {
        name: "不可信商品",
        retailerName: "Unknown",
        productUrl: "https://example.invalid/product/1",
      },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.retailerName).toBe("momo");
  });

  it("rejects retailer search pages that do not prove a specific listing exists", () => {
    const candidates = sanitizeCommerceCandidates([
      {
        name: "統一 PH9.0 鹼性離子水",
        retailerName: "momo",
        productUrl: "https://www.momoshop.com.tw/search/searchShop.jsp?keyword=PH9.0",
      },
      {
        name: "悅氏礦泉水",
        retailerName: "PChome",
        productUrl: "https://ecshweb.pchome.com.tw/search/v3.3/?q=礦泉水",
      },
    ]);
    expect(candidates).toHaveLength(0);
  });

  it("drops pack-size merchandising text mistakenly returned as a brand", () => {
    const candidates = sanitizeCommerceCandidates([
      {
        name: "[24罐/箱]史努比xHIGH UP日系彈珠氣泡水 330ml",
        brandName: "24罐/箱",
        retailerName: "7-ELEVEN",
        productUrl: "https://www.books.com.tw/products/N001234567",
      },
      {
        name: "統一 PH9.0 鹼性離子水 800ml",
        brandName: "統一",
        retailerName: "momo",
        productUrl: "https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=123",
      },
    ]);

    expect(candidates[0]?.brandName).toBeNull();
    expect(candidates[1]?.brandName).toBe("統一");
  });

  it("builds retailer searches without claiming the item is in stock", () => {
    const links = buildShoppingLinks("高效益生菌", "MIHONG");
    expect(links).toHaveLength(3);
    expect(links.every(link => link.url.startsWith("https://"))).toBe(true);
  });
});
