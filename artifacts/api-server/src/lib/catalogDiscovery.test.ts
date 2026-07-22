import { describe, expect, it } from "vitest";
import {
  expandCatalogSearchTerms,
  rankCommerceCandidates,
  scoreCatalogCandidate,
} from "./catalogDiscovery.js";

describe("catalog discovery", () => {
  it("expands an ambiguous water search into beverage product families", () => {
    expect(expandCatalogSearchTerms("水")).toContain("飲用水");
    expect(expandCatalogSearchTerms("水")).toContain("離子水");
  });

  it("rejects water-related foods for a bottled-water intent", () => {
    expect(scoreCatalogCandidate("水", { name: "水蜜桃鮮果凍" })).toBeLessThan(0);
    expect(scoreCatalogCandidate("水", { name: "統一 PH9.0 鹼性離子水" })).toBeGreaterThan(70);
  });

  it("keeps only trusted, relevant commerce product pages", () => {
    const ranked = rankCommerceCandidates("水", [
      {
        name: "統一 PH9.0 鹼性離子水 800ml",
        brandName: "統一",
        retailerName: "momo",
        priceNtd: 299,
        productUrl: "https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=123",
        whyMatchZh: "同為瓶裝飲用水。",
      },
      {
        name: "水蜜桃果凍",
        brandName: "測試",
        retailerName: "momo",
        priceNtd: 99,
        productUrl: "https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=456",
        whyMatchZh: "名稱含水。",
      },
      {
        name: "純水",
        brandName: "不可信",
        retailerName: "未知",
        priceNtd: null,
        productUrl: "https://example.com/product/1",
        whyMatchZh: "同類。",
      },
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.name).toContain("離子水");
    expect(ranked[0]?.matchConfidence).toBe("strong");
  });
});
