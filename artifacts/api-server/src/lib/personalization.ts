export type HouseholdFoodProfile = {
  id: string;
  name: string;
  relationship: "partner" | "child" | "parent" | "other";
  allergens: string[];
  dietaryPreferences: string[];
  avoidIngredients: string[];
  habits: string[];
  notes?: string | null;
};

export type StoredFoodPreferences = {
  displayName?: string | null;
  allergens?: unknown;
  dietaryPreferences?: unknown;
  avoidIngredients?: unknown;
  habits?: unknown;
  notes?: string | null;
  householdMembers?: unknown;
  personalizationEnabled?: boolean;
  updatedAt?: Date | string | null;
};

export type ProductPersonalizationEvidence = {
  allergens: Array<{ name?: string | null; nameZh?: string | null }>;
  ingredientNames: string[];
  negativeReasons: Array<{ label?: string | null; labelZh?: string | null }>;
  additiveFlags: Array<{
    name?: string | null;
    nameZh?: string | null;
    riskLevel?: string | null;
  }>;
};

export type PersonalAlertResult = {
  type: string;
  message: string;
  messageZh: string;
  severity: "high" | "caution" | "info";
  profileNames: string[];
};

export type PersonalizationResult = {
  personalAlerts: PersonalAlertResult[];
  personalization: {
    enabled: boolean;
    profileNames: string[];
    conditionCount: number;
    updatedAt: string | null;
  };
};

type FoodProfile = Omit<HouseholdFoodProfile, "id" | "relationship">;

const ALLERGEN_ALIASES: Record<string, string[]> = {
  milk: ["milk", "dairy", "乳", "牛奶", "奶粉", "乳製品"],
  egg: ["egg", "蛋", "雞蛋", "蛋白", "蛋黃"],
  peanut: ["peanut", "花生"],
  treenut: [
    "tree nut",
    "treenut",
    "堅果",
    "杏仁",
    "腰果",
    "核桃",
    "榛果",
    "開心果",
  ],
  sesame: ["sesame", "芝麻"],
  soy: ["soy", "soybean", "大豆", "黃豆"],
  wheat: ["wheat", "gluten", "小麥", "麩質"],
  fish: ["fish", "魚", "魚粉", "魚油", "魚露"],
  shellfish: ["shellfish", "crustacean", "甲殼", "蝦", "蟹"],
};

const ALLERGEN_LABELS_ZH: Record<string, string> = {
  milk: "乳",
  egg: "蛋",
  peanut: "花生",
  treenut: "堅果",
  sesame: "芝麻",
  soy: "大豆",
  wheat: "小麥／麩質",
  fish: "魚",
  shellfish: "甲殼類",
};

const DIETARY_CONFLICTS: Record<string, string[]> = {
  vegan: [
    "milk",
    "dairy",
    "乳",
    "牛奶",
    "奶粉",
    "乳清",
    "起司",
    "cheese",
    "egg",
    "蛋",
    "honey",
    "蜂蜜",
    "gelatin",
    "明膠",
    "fish",
    "魚",
    "蝦",
    "蟹",
    "beef",
    "牛肉",
    "pork",
    "豬肉",
    "chicken",
    "雞肉",
  ],
  vegetarian: [
    "gelatin",
    "明膠",
    "fish",
    "魚",
    "蝦",
    "蟹",
    "beef",
    "牛肉",
    "pork",
    "豬肉",
    "chicken",
    "雞肉",
  ],
  halal: ["pork", "豬", "lard", "豬油", "gelatin", "明膠", "alcohol", "酒精"],
  kosher: ["pork", "豬", "lard", "豬油", "shellfish", "甲殼", "蝦", "蟹"],
};

const DIETARY_LABELS_ZH: Record<string, string> = {
  vegan: "純素",
  vegetarian: "蛋奶素",
  halal: "清真",
  kosher: "猶太潔食",
};

function stringArray(value: unknown, limit = 30): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s()（）\[\]【】.,，。:：;；/_-]/g, "");
}

function aliasesFor(value: string): string[] {
  return ALLERGEN_ALIASES[value] ?? [value];
}

function includesAlias(
  value: string,
  aliases: string[],
  allowShortSubstring = false,
): boolean {
  const normalized = normalize(value);
  return aliases.some((alias) => {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias) return false;
    if (normalizedAlias.length === 1 && !allowShortSubstring) {
      return normalized === normalizedAlias;
    }
    return normalized.includes(normalizedAlias);
  });
}

function findIngredient(ingredients: string[], terms: string[]): string | null {
  return (
    ingredients.find((ingredient) => includesAlias(ingredient, terms)) ?? null
  );
}

function parseHouseholdMembers(value: unknown): HouseholdFoodProfile[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((item): HouseholdFoodProfile[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const id =
        typeof record.id === "string" ? record.id.trim().slice(0, 64) : "";
      const name =
        typeof record.name === "string" ? record.name.trim().slice(0, 80) : "";
      const relationship = ["partner", "child", "parent", "other"].includes(
        String(record.relationship),
      )
        ? (record.relationship as HouseholdFoodProfile["relationship"])
        : "other";
      if (!id || !name) return [];

      return [
        {
          id,
          name,
          relationship,
          allergens: stringArray(record.allergens, 20),
          dietaryPreferences: stringArray(record.dietaryPreferences, 20),
          avoidIngredients: stringArray(record.avoidIngredients, 30),
          habits: stringArray(record.habits, 20),
          notes:
            typeof record.notes === "string"
              ? record.notes.trim().slice(0, 500) || null
              : null,
        },
      ];
    })
    .slice(0, 6);
}

function countConditions(profile: FoodProfile): number {
  return (
    profile.allergens.length +
    profile.dietaryPreferences.length +
    profile.avoidIngredients.length +
    profile.habits.length +
    (profile.notes?.trim() ? 1 : 0)
  );
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildProfileAlerts(
  profile: FoodProfile,
  evidence: ProductPersonalizationEvidence,
): PersonalAlertResult[] {
  const alerts: PersonalAlertResult[] = [];
  const allergenLabels = evidence.allergens
    .flatMap((item) => [item.nameZh, item.name])
    .filter((item): item is string => Boolean(item));

  for (const allergen of profile.allergens) {
    const aliases = aliasesFor(allergen);
    const declaredMatch = allergenLabels.find((label) =>
      includesAlias(label, aliases, true),
    );
    const ingredientMatch = declaredMatch
      ? null
      : findIngredient(evidence.ingredientNames, aliases);
    if (!declaredMatch && !ingredientMatch) continue;

    const label = ALLERGEN_LABELS_ZH[allergen] ?? allergen;
    const evidenceLabel = declaredMatch ?? ingredientMatch ?? label;
    alerts.push({
      type: "allergen",
      severity: declaredMatch ? "high" : "caution",
      profileNames: [profile.name],
      message: `${profile.name}: the package evidence includes “${evidenceLabel}”, which conflicts with the saved ${allergen} allergen setting. Check the physical package before consuming.`,
      messageZh: `${profile.name}：包裝證據出現「${evidenceLabel}」，與已設定的${label}過敏原衝突；食用前請再核對實體標示。`,
    });
  }

  for (const avoided of profile.avoidIngredients) {
    const match = findIngredient(evidence.ingredientNames, [avoided]);
    if (!match) continue;
    alerts.push({
      type: "avoid_ingredient",
      severity: "caution",
      profileNames: [profile.name],
      message: `${profile.name}: the ingredient list includes “${match}”, matching the saved ingredient to avoid “${avoided}”.`,
      messageZh: `${profile.name}：成分表出現「${match}」，符合已設定想避開的「${avoided}」。`,
    });
  }

  for (const diet of profile.dietaryPreferences) {
    const match = findIngredient(
      evidence.ingredientNames,
      DIETARY_CONFLICTS[diet] ?? [],
    );
    if (!match) continue;
    const label = DIETARY_LABELS_ZH[diet] ?? diet;
    alerts.push({
      type: "dietary",
      severity: "caution",
      profileNames: [profile.name],
      message: `${profile.name}: “${match}” may conflict with the saved ${diet} preference. Certification and the physical package remain authoritative.`,
      messageZh: `${profile.name}：成分表的「${match}」可能不符合已設定的${label}；仍應以認證與實體包裝為準。`,
    });
  }

  const negativeReasonText = evidence.negativeReasons
    .map((reason) => `${reason.labelZh ?? ""} ${reason.label ?? ""}`)
    .join(" ");
  if (
    profile.habits.includes("low_sugar") &&
    /糖|sugar/i.test(negativeReasonText)
  ) {
    alerts.push({
      type: "habit",
      severity: "caution",
      profileNames: [profile.name],
      message: `${profile.name}: this product has a negative sugar finding, and the saved habit is to reduce sugar.`,
      messageZh: `${profile.name}：這款商品的糖是負向指標，與已設定的「少糖」習慣不符。`,
    });
  }
  if (
    profile.habits.includes("low_sodium") &&
    /鈉|鹽|sodium|salt/i.test(negativeReasonText)
  ) {
    alerts.push({
      type: "habit",
      severity: "caution",
      profileNames: [profile.name],
      message: `${profile.name}: this product has a negative sodium finding, and the saved habit is to reduce sodium.`,
      messageZh: `${profile.name}：這款商品的鈉是負向指標，與已設定的「少鈉」習慣不符。`,
    });
  }
  if (profile.habits.includes("avoid_caffeine")) {
    const caffeine = findIngredient(evidence.ingredientNames, [
      "caffeine",
      "咖啡因",
    ]);
    if (caffeine) {
      alerts.push({
        type: "habit",
        severity: "caution",
        profileNames: [profile.name],
        message: `${profile.name}: the ingredient list includes “${caffeine}”, and the saved habit is to avoid caffeine.`,
        messageZh: `${profile.name}：成分表出現「${caffeine}」，與已設定的「避免咖啡因」習慣不符。`,
      });
    }
  }
  if (profile.habits.includes("less_processed")) {
    const flagged = evidence.additiveFlags.find((flag) =>
      ["caution", "avoid"].includes(flag.riskLevel ?? ""),
    );
    if (flagged) {
      const label = flagged.nameZh || flagged.name || "需留意的添加物";
      alerts.push({
        type: "habit",
        severity: "info",
        profileNames: [profile.name],
        message: `${profile.name}: the analysis flags “${label}”, relevant to the saved preference for fewer processed ingredients.`,
        messageZh: `${profile.name}：分析標記「${label}」，與已設定的「少加工」習慣相關，建議展開成分證據確認。`,
      });
    }
  }

  return alerts;
}

export function buildPersonalization(
  preferences: StoredFoodPreferences | null | undefined,
  evidence: ProductPersonalizationEvidence,
): PersonalizationResult {
  if (!preferences?.personalizationEnabled) {
    return {
      personalAlerts: [],
      personalization: {
        enabled: false,
        profileNames: [],
        conditionCount: 0,
        updatedAt: null,
      },
    };
  }

  const primary: FoodProfile = {
    name: preferences.displayName?.trim() || "你",
    allergens: stringArray(preferences.allergens, 20),
    dietaryPreferences: stringArray(preferences.dietaryPreferences, 20),
    avoidIngredients: stringArray(preferences.avoidIngredients, 30),
    habits: stringArray(preferences.habits, 20),
    notes: preferences.notes?.trim() || null,
  };
  const members = parseHouseholdMembers(preferences.householdMembers);
  const profiles: FoodProfile[] = [
    primary,
    ...members.map((member) => ({
      name: member.name,
      allergens: member.allergens,
      dietaryPreferences: member.dietaryPreferences,
      avoidIngredients: member.avoidIngredients,
      habits: member.habits,
      notes: member.notes,
    })),
  ];

  return {
    personalAlerts: profiles
      .flatMap((profile) => buildProfileAlerts(profile, evidence))
      .slice(0, 20),
    personalization: {
      enabled: true,
      profileNames: profiles.map((profile) => profile.name),
      conditionCount: profiles.reduce(
        (total, profile) => total + countConditions(profile),
        0,
      ),
      updatedAt: isoDate(preferences.updatedAt),
    },
  };
}
