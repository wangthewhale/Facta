import { describe, expect, it } from "vitest";
import { buildPersonalization } from "./personalization.js";

const baseEvidence = {
  allergens: [{ name: "Milk", nameZh: "乳" }],
  ingredientNames: ["水", "奶粉", "咖啡因", "砂糖"],
  negativeReasons: [{ label: "High sugar", labelZh: "糖偏高" }],
  additiveFlags: [],
};

describe("buildPersonalization", () => {
  it("returns no household context when explicit personalization is disabled", () => {
    const result = buildPersonalization(
      {
        displayName: "小安",
        allergens: ["milk"],
        personalizationEnabled: false,
      },
      baseEvidence,
    );

    expect(result.personalAlerts).toEqual([]);
    expect(result.personalization).toEqual({
      enabled: false,
      profileNames: [],
      conditionCount: 0,
      updatedAt: null,
    });
  });

  it("applies the latest explicit settings for the user and family members", () => {
    const updatedAt = new Date("2026-07-22T08:00:00.000Z");
    const result = buildPersonalization(
      {
        displayName: "小安",
        allergens: ["milk"],
        habits: ["low_sugar"],
        personalizationEnabled: true,
        updatedAt,
        householdMembers: [
          {
            id: "member-1",
            name: "媽媽",
            relationship: "parent",
            allergens: [],
            dietaryPreferences: [],
            avoidIngredients: ["咖啡因"],
            habits: [],
            notes: "晚上不要喝含咖啡因飲料",
          },
        ],
      },
      baseEvidence,
    );

    expect(result.personalization).toEqual({
      enabled: true,
      profileNames: ["小安", "媽媽"],
      conditionCount: 4,
      updatedAt: updatedAt.toISOString(),
    });
    expect(result.personalAlerts.map((alert) => alert.type)).toEqual([
      "allergen",
      "habit",
      "avoid_ingredient",
    ]);
    expect(result.personalAlerts[0]?.messageZh).toContain("小安");
    expect(result.personalAlerts[2]?.messageZh).toContain("媽媽");
  });

  it("does not interpret free-form family notes as medical rules", () => {
    const result = buildPersonalization(
      {
        displayName: "小安",
        notes: "最近睡不好",
        personalizationEnabled: true,
      },
      baseEvidence,
    );

    expect(result.personalization.conditionCount).toBe(1);
    expect(result.personalAlerts).toEqual([]);
  });

  it("does not mistake lactic acid text for a declared milk allergen", () => {
    const result = buildPersonalization({
      displayName: "小安",
      allergens: ["milk"],
      personalizationEnabled: true,
    }, {
      allergens: [],
      ingredientNames: ["乳酸", "水"],
      negativeReasons: [],
      additiveFlags: [],
    });

    expect(result.personalAlerts).toEqual([]);
  });
});
