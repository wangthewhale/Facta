import { describe, expect, it } from "vitest";
import {
  expandUpcE,
  isValidRetailGtin,
  normalizeRetailGtin,
  retailGtinLookupVariants,
} from "./barcodeIdentity.js";

describe("retail GTIN identity", () => {
  it("normalizes equivalent UPC-A, EAN-13 and zero-indicator GTIN-14 keys", () => {
    expect(isValidRetailGtin("034000470693")).toBe(true);
    expect(normalizeRetailGtin("034000470693")).toBe("0034000470693");
    expect(retailGtinLookupVariants("034000470693")).toEqual(expect.arrayContaining([
      "034000470693",
      "0034000470693",
      "00034000470693",
    ]));
    expect(normalizeRetailGtin("00034000470693")).toBe("0034000470693");
  });

  it("expands a valid UPC-E but rejects a bad check digit", () => {
    expect(expandUpcE("04210007")).toBe("042000001007");
    expect(normalizeRetailGtin("04210007")).toBe("0042000001007");
    expect(isValidRetailGtin("04210006")).toBe(false);
  });

  it("does not accept an arbitrary numeric string", () => {
    expect(isValidRetailGtin("2012345004244")).toBe(false);
    expect(retailGtinLookupVariants("2012345004244")).toEqual([]);
  });

  it("accepts a check-digit-valid restricted-circulation code without inferring its retailer", () => {
    expect(isValidRetailGtin("2012345004245")).toBe(true);
    expect(normalizeRetailGtin("2012345004245")).toBe("2012345004245");
    expect(retailGtinLookupVariants("2012345004245")).toEqual(["2012345004245", "02012345004245"]);
  });
});
