import { describe, expect, it } from "vitest";
import { validateDecisionCombination } from "./decisionOutcomes.js";

describe("validateDecisionCombination", () => {
  it("accepts a purchase after a buy recommendation", () => {
    expect(
      validateDecisionCombination({
        productId: 11,
        recommendationCode: "buy",
        outcomeCode: "bought",
      }),
    ).toBeNull();
  });

  it("accepts a real alternative after a swap recommendation", () => {
    expect(
      validateDecisionCombination({
        productId: 4,
        recommendationCode: "swap",
        outcomeCode: "swapped",
        selectedAlternativeProductId: 6,
      }),
    ).toBeNull();
  });

  it("rejects outcomes that do not match the displayed recommendation", () => {
    expect(
      validateDecisionCombination({
        productId: 1,
        recommendationCode: "complete_data",
        outcomeCode: "bought",
      }),
    ).toContain("does not match");
  });

  it("requires a different product for a swapped outcome", () => {
    expect(
      validateDecisionCombination({
        productId: 4,
        recommendationCode: "swap",
        outcomeCode: "swapped",
      }),
    ).toContain("requires");

    expect(
      validateDecisionCombination({
        productId: 4,
        recommendationCode: "swap",
        outcomeCode: "swapped",
        selectedAlternativeProductId: 4,
      }),
    ).toContain("different product");
  });

  it("does not attach an alternative to a non-swap outcome", () => {
    expect(
      validateDecisionCombination({
        productId: 4,
        recommendationCode: "swap",
        outcomeCode: "kept",
        selectedAlternativeProductId: 6,
      }),
    ).toContain("only be stored");
  });
});
