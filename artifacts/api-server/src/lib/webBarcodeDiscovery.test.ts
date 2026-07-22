import { describe, expect, it } from "vitest";
import { sanitizeWebBarcodeCandidate } from "./webBarcodeDiscovery.js";

describe("web barcode discovery evidence gate", () => {
  it("accepts an exact barcode and direct evidence URL", () => {
    const candidate = sanitizeWebBarcodeCandidate("4710000000016", {
      barcode: "4710000000016",
      productName: "Hi-Life 測試飯糰",
      productNameZh: "萊爾富測試飯糰",
      brandName: "Hi-Life",
      retailerName: "萊爾富",
      sourceUrl: "https://www.hilife.com.tw/product/4710000000016",
      secondarySourceUrl: "https://example.com/item/4710000000016",
    });
    expect(candidate?.retailerSlug).toBe("hi-life");
    expect(candidate?.retailerConfidence).toBe("confirmed");
    expect(candidate?.identityEvidenceUrls).toHaveLength(2);
  });

  it("rejects a partial or different barcode", () => {
    expect(sanitizeWebBarcodeCandidate("4710000000016", {
      barcode: "471000000001",
      productName: "看起來相似的商品",
      sourceUrl: "https://example.com/item",
    })).toBeNull();
  });

  it("rejects non-http evidence and missing product identity", () => {
    expect(sanitizeWebBarcodeCandidate("4710000000016", {
      barcode: "4710000000016",
      productName: "商品",
      sourceUrl: "javascript:alert(1)",
    })).toBeNull();
    expect(sanitizeWebBarcodeCandidate("4710000000016", {
      barcode: "4710000000016",
      sourceUrl: "https://example.com/item",
    })).toBeNull();
  });
});
