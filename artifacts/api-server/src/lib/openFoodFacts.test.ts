import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/facta_test";
});
import { resolveExternalBarcodeCandidates, type ExternalBarcodeCandidate } from "./openFoodFacts.js";

function candidate(overrides: Partial<ExternalBarcodeCandidate>): ExternalBarcodeCandidate {
  return {
    barcode: "4710000000016",
    productName: "海鹽御飯糰 110g",
    productNameZh: "海鹽御飯糰 110g",
    brandName: "7-ELEVEN",
    imageUrl: null,
    evidenceTier: "catalog_only",
    sourceName: "Open Food Facts",
    sourceUrl: "https://world.openfoodfacts.org/product/4710000000016",
    identityEvidenceUrls: ["https://world.openfoodfacts.org/product/4710000000016"],
    verificationStatus: "external_unverified",
    retailerName: null,
    retailerSlug: null,
    retailerConfidence: "unknown",
    retailerEvidence: "unknown",
    retailerReasonZh: "尚未確認",
    ...overrides,
  };
}

describe("external barcode identity consensus", () => {
  it("corroborates identical full product identities and prefers official catalog evidence", () => {
    const result = resolveExternalBarcodeCandidates([
      candidate({}),
      candidate({
        sourceName: "FACTA Web Identity",
        sourceUrl: "https://www.7-11.com.tw/product/4710000000016",
        retailerName: "7-ELEVEN",
        retailerSlug: "7eleven",
        retailerConfidence: "confirmed",
        retailerEvidence: "official_catalog",
      }),
    ]);
    expect(result.status).toBe("corroborated");
    expect(result.candidate?.retailerSlug).toBe("7eleven");
  });

  it("refuses to choose when the same barcode has conflicting flavor or size identities", () => {
    const result = resolveExternalBarcodeCandidates([
      candidate({}),
      candidate({
        productName: "鮪魚御飯糰 105g",
        productNameZh: "鮪魚御飯糰 105g",
        sourceUrl: "https://example.com/other",
      }),
    ]);
    expect(result.status).toBe("conflict");
    expect(result.candidate).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });
});
