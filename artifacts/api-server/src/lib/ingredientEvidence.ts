export const TFDA_ADDITIVE_SAFETY_URL = "https://www.fda.gov.tw/TC/faqContent.aspx?id=175";
export const TFDA_ADDITIVE_NAMES_URL = "https://www.fda.gov.tw/TC/siteContent.aspx?sid=10159";
export const TFDA_ADDITIVE_USE_URL = "https://www.fda.gov.tw/TC/newsContent.aspx?cid=4&id=14116";
export const HPA_HEALTHY_DIET_URL = "https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=543&pid=8365&sid=8382";

export type IngredientRiskLevel = "safe" | "caution" | "avoid" | "unknown";

export interface IngredientReferenceLike {
  name: string;
  nameZh?: string | null;
  riskLevel?: string | null;
  isAdditive?: string | null;
  evidenceStrength?: string | null;
  riskReason?: string | null;
}

export interface MappedIngredientEvidence {
  name: string;
  riskLevel: IngredientRiskLevel;
  isAdditive: string | null;
  evidenceStrength: string | null;
  riskReason: string | null;
  riskReasonZh: string | null;
  source: string | null;
}

interface BuiltInEvidence {
  aliases: string[];
  riskLevel: Exclude<IngredientRiskLevel, "unknown">;
  isAdditive: boolean;
  riskReason: string;
  riskReasonZh: string;
  source: string;
}

const COMMON_FOOD_SOURCE = "使用者確認的包裝成分";

/**
 * A deliberately small, source-backed fallback for common Taiwan label terms.
 *
 * It is not a blacklist. TFDA-permitted functional additives are mapped as
 * reviewed, not as harmful. Dietary-frequency signals (added sugar, salt,
 * margarine and non-specific flavouring) are marked caution because the label
 * confirms their presence but does not provide the quantity needed for a
 * nutrition threshold judgment.
 */
const BUILT_IN_EVIDENCE: BuiltInEvidence[] = [
  {
    aliases: ["乙醯化己二酸二澱粉", "關華豆膠", "三仙膠", "玉米糖膠", "大豆卵磷脂", "卵磷脂", "乳酸硬脂酸甘油酯", "脂肪酸丙二醇酯", "單及雙脂肪酸甘油酯", "單雙脂肪酸甘油酯", "脂肪酸甘油酯", "海藻酸丙二醇酯", "脂肪酸蔗糖酯", "醋酸鈉", "甘胺酸", "胺基乙酸", "檸檬酸", "碘酸鉀"],
    riskLevel: "safe",
    isAdditive: true,
    riskReason: "This is a named functional additive in Taiwan's positive-list system; the name alone is not evidence of harm, and lawful use still depends on the permitted food category and limit.",
    riskReasonZh: "這是台灣正面表列制度中的具名功能性添加物；僅憑名稱不能判定有害，合法使用仍須符合准用食品範圍與限量。",
    source: TFDA_ADDITIVE_SAFETY_URL,
  },
  {
    aliases: ["人造奶油", "油脂抹醬", "脂肪抹醬"],
    riskLevel: "caution",
    isAdditive: false,
    riskReason: "A fat spread is present, but the label evidence does not quantify saturated or trans fat, so the concern is frequency rather than a claim that the ingredient is unsafe.",
    riskReasonZh: "配方含油脂抹醬，但目前沒有飽和脂肪與反式脂肪克數；這是降低日常食用頻率的訊號，不代表成分本身不合法或有毒。",
    source: HPA_HEALTHY_DIET_URL,
  },
  {
    aliases: ["葡萄糖", "蔗糖", "砂糖", "糖"],
    riskLevel: "caution",
    isAdditive: false,
    riskReason: "Added sugar is listed, but the quantity is unknown, so it cannot be classified as high-sugar from the ingredient list alone.",
    riskReasonZh: "包裝可確認有添加糖，但沒有糖的克數；不能只靠成分表判定為高糖，仍可作為不建議天天吃的頻率訊號。",
    source: HPA_HEALTHY_DIET_URL,
  },
  {
    aliases: ["食鹽", "鹽"],
    riskLevel: "caution",
    isAdditive: false,
    riskReason: "Salt is listed, but sodium cannot be classified without a labelled quantity.",
    riskReasonZh: "包裝可確認有加鹽，但沒有鈉含量，不能判定為高鈉；仍需要營養標示才能量化。",
    source: HPA_HEALTHY_DIET_URL,
  },
  {
    aliases: ["香料", "食用香料"],
    riskLevel: "caution",
    isAdditive: true,
    riskReason: "The generic term flavouring does not disclose the exact formulation; this is a transparency limitation, not proof of toxicity.",
    riskReasonZh: "「香料」是用途通稱，無法從標示確認具體配方；這代表透明度有限，不等於有毒。",
    source: TFDA_ADDITIVE_SAFETY_URL,
  },
  {
    aliases: ["麵粉", "小麥粉", "全麥粉", "蛋白粉", "小麥蛋白", "乳清蛋白", "奶粉", "牛奶", "雞蛋", "蛋", "水", "澱粉", "玉米澱粉", "大豆油", "芥花油", "菜籽油", "芥子油", "麥芽糊精", "酵母", "胡蘿蔔", "大豆"],
    riskLevel: "safe",
    isAdditive: false,
    riskReason: "This is a recognizable food ingredient; suitability still depends on quantity, allergies and the rest of the diet.",
    riskReasonZh: "這是可辨識的一般食品原料；是否適合仍取決於用量、過敏條件與整體飲食。",
    source: COMMON_FOOD_SOURCE,
  },
];

function normalizeIngredientName(value: string): string {
  return value
    .toLowerCase()
    .replace(/※?過敏原[：:].*$/u, "")
    .replace(/[\s()（）\[\]【】.。:：、,，;；·・_\-]/g, "")
    .trim();
}

const BUILT_IN_ALIASES = BUILT_IN_EVIDENCE
  .flatMap(evidence => evidence.aliases.map(alias => ({
    normalizedAlias: normalizeIngredientName(alias),
    evidence,
  })))
  .sort((a, b) => b.normalizedAlias.length - a.normalizedAlias.length);

export function stripAllergenDeclaration(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.split(/※?\s*過敏原\s*[：:]/u, 1)[0]?.trim() ?? "";
}

export function splitIngredientList(raw: string | null | undefined): string[] {
  return stripAllergenDeclaration(raw)
    .split(/[、,，;；\n]/)
    .map(value => value.trim().replace(/[.。]+$/u, "").trim())
    .filter(value => value.length > 0)
    .slice(0, 100);
}

function builtInEvidenceForName(name: string): BuiltInEvidence | null {
  const normalized = normalizeIngredientName(name);
  if (!normalized) return null;
  return BUILT_IN_ALIASES.find(item =>
    normalized === item.normalizedAlias ||
    (item.normalizedAlias.length >= 2 && normalized.includes(item.normalizedAlias))
  )?.evidence ?? null;
}

function normalizedRiskLevel(value: string | null | undefined): IngredientRiskLevel {
  return value === "safe" || value === "caution" || value === "avoid" ? value : "unknown";
}

export function mapIngredientEvidence(
  name: string,
  references: IngredientReferenceLike[] = [],
): MappedIngredientEvidence {
  const normalized = normalizeIngredientName(name);
  const reference = references.find(item => {
    const names = [item.name, item.nameZh].filter(Boolean) as string[];
    return names.some(candidate => normalizeIngredientName(candidate) === normalized);
  });
  if (reference && normalizedRiskLevel(reference.riskLevel) !== "unknown") {
    return {
      name,
      riskLevel: normalizedRiskLevel(reference.riskLevel),
      isAdditive: reference.isAdditive ?? null,
      evidenceStrength: reference.evidenceStrength ?? "medium",
      riskReason: reference.riskReason ?? null,
      riskReasonZh: reference.riskReason ?? null,
      source: "FACTA ingredient evidence database",
    };
  }

  const builtIn = builtInEvidenceForName(name);
  if (!builtIn) {
    return {
      name,
      riskLevel: "unknown",
      isAdditive: reference?.isAdditive ?? null,
      evidenceStrength: reference?.evidenceStrength ?? null,
      riskReason: reference?.riskReason ?? null,
      riskReasonZh: reference?.riskReason ?? null,
      source: null,
    };
  }

  return {
    name,
    riskLevel: builtIn.riskLevel,
    isAdditive: builtIn.isAdditive ? "true" : "false",
    evidenceStrength: "medium",
    riskReason: builtIn.riskReason,
    riskReasonZh: builtIn.riskReasonZh,
    source: builtIn.source,
  };
}

export function mapIngredientList(
  raw: string | null | undefined,
  references: IngredientReferenceLike[] = [],
): MappedIngredientEvidence[] {
  return splitIngredientList(raw).map(name => mapIngredientEvidence(name, references));
}

export interface DeclaredAllergenEvidence {
  name: string;
  nameZh: string;
  severity: "high";
  source: "user_confirmed_package_label";
}

const ALLERGEN_ALIASES: Array<{ name: string; nameZh: string; aliases: string[] }> = [
  { name: "Gluten-containing grains", nameZh: "含麩質之穀物", aliases: ["含麩質之穀物", "麩質", "小麥"] },
  { name: "Egg", nameZh: "蛋", aliases: ["蛋類", "蛋"] },
  { name: "Milk", nameZh: "牛奶", aliases: ["乳製品", "牛奶", "奶類"] },
  { name: "Soy", nameZh: "大豆", aliases: ["黃豆", "大豆"] },
  { name: "Peanut", nameZh: "花生", aliases: ["花生"] },
  { name: "Tree nuts", nameZh: "堅果類", aliases: ["堅果"] },
  { name: "Sesame", nameZh: "芝麻", aliases: ["芝麻"] },
  { name: "Fish", nameZh: "魚類", aliases: ["魚類", "魚"] },
  { name: "Crustaceans", nameZh: "甲殼類", aliases: ["甲殼類", "蝦", "蟹"] },
];

export function extractDeclaredAllergens(raw: string | null | undefined): DeclaredAllergenEvidence[] {
  if (!raw) return [];
  const match = raw.match(/※?\s*過敏原\s*[：:]\s*([\s\S]*)$/u);
  if (!match?.[1]) return [];
  const declared = match[1];
  const seen = new Set<string>();
  return ALLERGEN_ALIASES.flatMap(item => {
    if (!item.aliases.some(alias => declared.includes(alias)) || seen.has(item.name)) return [];
    seen.add(item.name);
    return [{
      name: item.name,
      nameZh: item.nameZh,
      severity: "high" as const,
      source: "user_confirmed_package_label" as const,
    }];
  });
}
