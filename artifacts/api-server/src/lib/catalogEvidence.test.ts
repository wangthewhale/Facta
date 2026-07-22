import { describe, expect, it } from "vitest";
import { calculateScore } from "./scoring.js";
import {
  getTrustedProductEvidenceByBarcode,
  isValidGtin,
  resolveCatalogProduct,
} from "./catalogEvidence.js";

const legacyBase = {
  imageUrl: "https://images.unsplash.com/photo-demo",
  ingredientsList: "demo",
  verificationStatus: "verified",
  brandId: 1,
};

describe("source-backed catalog evidence", () => {
  it("replaces the AGV demo identity with the exact verified SKU", () => {
    const product = resolveCatalogProduct(
      {
        ...legacyBase,
        id: 6,
        name: "AGV Double Fiber Barley Tea",
        nameZh: "愛之味雙纖麥仔茶",
      },
      "4710626255314",
      { name: "AGV" },
    );

    expect(product.nameZh).toBe("愛之味 分解茶雙纖麥茶 590ml");
    expect(product.brandName).toBe("愛之味");
    expect(product.barcode).toBe("4710626255314");
    expect(product.imageUrl).toContain("240925000062448001.jpg");
    expect(product.verificationStatus).toBe("verified");
    expect(
      calculateScore({
        nutrition: product.evidence!.nutrition,
        ingredients: [],
        dataCompleteness: 1,
      }).overallScore,
    ).toBe(86);
  });

  it("replaces the Want Want demo row with the exact 112g package and label values", () => {
    const product = resolveCatalogProduct(
      {
        ...legacyBase,
        id: 4,
        name: "Want Want Rice Crackers",
        nameZh: "旺旺仙貝",
      },
      "4710918001290",
      { name: "Want Want" },
    );

    expect(product.nameZh).toBe("旺旺仙貝米果 112g（2枚×20袋）");
    expect(product.brandName).toBe("旺旺");
    expect(product.barcode).toBe("4710144201206");
    expect(product.imageUrl).toContain("452c3d14bf71405886165e9b24c08105.jpg");
    expect(
      calculateScore({
        nutrition: product.evidence!.nutrition,
        ingredients: [],
        dataCompleteness: 1,
      }).overallScore,
    ).toBe(36);
  });

  it("resolves the scanned PH9.0 water to the exact official brand, image and barcode", () => {
    const product = resolveCatalogProduct(
      {
        ...legacyBase,
        id: 11,
        name: "統一PH9.0鹼性離子水",
        nameZh: "統一PH9.0鹼性離子水",
        ingredientsList: "水、海水",
        imageUrl: null,
        verificationStatus: "provisional",
      },
      "4710088637574",
      { name: "統一企業（股）公司" },
    );

    expect(product.nameZh).toBe("統一PH9.0鹼性離子水 800ml");
    expect(product.brandName).toBe("統一");
    expect(product.barcode).toBe("4710088637574");
    expect(product.imageUrl).toContain("20140402195619_58489.jpg");
    expect(product.verificationStatus).toBe("verified");
    expect(calculateScore({
      productName: product.nameZh,
      nutrition: product.evidence!.nutrition,
      ingredients: product.evidence!.ingredientsList.split("、").map(name => ({ name })),
      dataCompleteness: 0.3,
    }).analysisScope).toBe("water");
  });

  it("downgrades unsupported legacy demo rows and removes generic imagery", () => {
    const product = resolveCatalogProduct(
      {
        ...legacyBase,
        id: 1,
        name: "Uni-President Green Tea",
        nameZh: "統一綠茶",
      },
      "4710088033427",
      { name: "Uni-President", nameZh: "統一" },
    );

    expect(product.verificationStatus).toBe("catalog_unverified");
    expect(product.imageUrl).toBeNull();
    expect(product.ingredientsList).toBeNull();
  });

  it("validates real GTIN check digits before catalog lookup", () => {
    expect(isValidGtin("4710626255314")).toBe(true);
    expect(isValidGtin("4710144201206")).toBe(true);
    expect(isValidGtin("4710918001290")).toBe(false);
    expect(isValidGtin("4710088033427")).toBe(false);
    expect(getTrustedProductEvidenceByBarcode("4710088637574")?.productId).toBe(
      11,
    );
    expect(getTrustedProductEvidenceByBarcode("4710144201206")?.productId).toBe(
      4,
    );
  });
});
