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

  it("builds retailer searches without claiming the item is in stock", () => {
    const links = buildShoppingLinks("高效益生菌", "MIHONG");
    expect(links).toHaveLength(3);
    expect(links.every(link => link.url.startsWith("https://"))).toBe(true);
  });
});
