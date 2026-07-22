import { describe, expect, it } from "vitest";
import { calculateScore } from "./scoring.js";
import {
  extractDeclaredAllergens,
  mapIngredientList,
  TFDA_ADDITIVE_SAFETY_URL,
} from "./ingredientEvidence.js";

const FAMILY_MART_SANDWICH_INGREDIENTS = "麵粉、蛋、水、糖、人造奶油、鹽、奶粉、澱粉、大豆油、芥花油、芥子油、關華豆膠、大豆卵磷脂、蛋白粉、乳清蛋白、白、小麥蛋白、乙醯化己二酸二澱粉、酵母、麥芽糊精、脂肪酸甘油酯、乳酸硬脂酸甘油酯、脂肪酸丙二醇酯、大豆卵磷脂、單及雙脂肪酸甘油酯、海藻酸丙二醇酯、葡萄糖、碘酸鉀、醋酸鈉、脂肪酸蔗糖酯、甘胺酸、檸檬酸、抽出物（酵母、胡蘿蔔）、香料。※過敏原：含麩質之穀物、蛋、牛奶、大豆";

describe("source-backed ingredient evidence", () => {
  it("maps enough of the photographed FamilyMart sandwich for an ingredient-only action", () => {
    const ingredients = mapIngredientList(FAMILY_MART_SANDWICH_INGREDIENTS);
    const reviewed = ingredients.filter(item => item.riskLevel !== "unknown");

    expect(reviewed.length / ingredients.length).toBeGreaterThanOrEqual(0.8);

    const result = calculateScore({
      productName: "雞蛋沙拉三明治",
      nutrition: { calories: 204 },
      ingredients,
      dataCompleteness: 0.5,
    });

    expect(result.analysisScope).toBe("ingredients_only");
    expect(result.additiveScore).not.toBeNull();
    expect(result.actionRecommendation.code).toBe("limit");
    expect(result.actionRecommendation.labelZh).toBe("少吃");
    expect(result.verdictZh).toContain("食用頻率");
    expect(result.additiveFlags.map(item => item.name)).toEqual([
      "糖",
      "人造奶油",
      "鹽",
      "香料",
    ]);
    expect(result.actionRecommendation.reasonZh).toContain("先偶爾吃");
  });

  it("does not treat named permitted functional additives as toxic by name alone", () => {
    const ingredients = mapIngredientList("乙醯化己二酸二澱粉、脂肪酸甘油酯、醋酸鈉、甘胺酸");

    expect(ingredients.every(item => item.riskLevel === "safe")).toBe(true);
    expect(ingredients.every(item => item.source === TFDA_ADDITIVE_SAFETY_URL)).toBe(true);
    expect(ingredients[0]?.riskReasonZh).toContain("僅憑名稱不能判定有害");
  });

  it("separates a non-specific flavouring transparency limit from a toxicity claim", () => {
    const [flavouring] = mapIngredientList("香料");

    expect(flavouring?.riskLevel).toBe("caution");
    expect(flavouring?.riskReasonZh).toContain("不等於有毒");
  });

  it("extracts explicitly declared allergens from the same confirmed label", () => {
    const allergens = extractDeclaredAllergens(FAMILY_MART_SANDWICH_INGREDIENTS);

    expect(allergens.map(item => item.nameZh)).toEqual(["含麩質之穀物", "蛋", "牛奶", "大豆"]);
    expect(allergens.every(item => item.source === "user_confirmed_package_label")).toBe(true);
  });
});
