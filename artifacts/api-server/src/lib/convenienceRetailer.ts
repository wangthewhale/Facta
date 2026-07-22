export type RetailerConfidence = "confirmed" | "strong" | "possible" | "unknown";
export type RetailerEvidence =
  | "retailer_record"
  | "official_catalog"
  | "package_or_brand"
  | "restricted_barcode_only"
  | "unknown";

export interface ConvenienceRetailerDefinition {
  slug: "7eleven" | "family-mart" | "hi-life" | "ok-mart";
  name: string;
  companyName: string;
  aliases: string[];
  officialDomains: string[];
}

export interface RetailerIdentity {
  retailerName: string | null;
  retailerSlug: ConvenienceRetailerDefinition["slug"] | null;
  retailerConfidence: RetailerConfidence;
  retailerEvidence: RetailerEvidence;
  retailerReasonZh: string;
}

export interface RetailerIdentityInput {
  barcode?: string | null;
  explicitRetailerName?: string | null;
  explicitRetailerSlug?: string | null;
  brandNames?: Array<string | null | undefined>;
  productNames?: Array<string | null | undefined>;
  packageText?: Array<string | null | undefined>;
  sourceNames?: Array<string | null | undefined>;
  sourceUrls?: Array<string | null | undefined>;
}

/**
 * Taiwan convenience-store identity registry.
 *
 * A GTIN identifies a trade item, not necessarily the shop where it was
 * purchased. Retailer identity therefore requires a retailer record, an
 * official retailer URL, or an explicit package/brand mark. Short aliases such
 * as "全家" and "OK" only match a complete field so ordinary prose cannot turn
 * into a false retailer attribution.
 */
export const CONVENIENCE_RETAILERS: ConvenienceRetailerDefinition[] = [
  {
    slug: "7eleven",
    name: "7-ELEVEN",
    companyName: "統一超商股份有限公司",
    aliases: [
      "7-ELEVEN", "7 ELEVEN", "7-11", "7 11", "SEVEN ELEVEN",
      "統一超商", "統一超商股份有限公司", "小七",
    ],
    officialDomains: ["7-11.com.tw", "ir.7-11.com.tw"],
  },
  {
    slug: "family-mart",
    name: "全家 FamilyMart",
    companyName: "全家便利商店股份有限公司",
    aliases: [
      "FamilyMart", "Family Mart", "Taiwan FamilyMart",
      "全家", "全家便利商店", "全家便利商店股份有限公司",
    ],
    officialDomains: ["family.com.tw"],
  },
  {
    slug: "hi-life",
    name: "萊爾富 Hi-Life",
    companyName: "萊爾富國際股份有限公司",
    aliases: [
      "Hi-Life", "Hi Life", "HiLife", "萊爾富", "萊爾富便利商店",
      "萊爾富國際", "萊爾富國際股份有限公司",
    ],
    officialDomains: ["hilife.com.tw"],
  },
  {
    slug: "ok-mart",
    name: "OKmart",
    companyName: "來來超商股份有限公司",
    aliases: [
      "OK", "OKmart", "OK mart", "OK超商", "來來超商",
      "來來超商股份有限公司",
    ],
    officialDomains: ["okmart.com.tw"],
  },
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function nonEmpty(values: Array<string | null | undefined> | undefined): string[] {
  return (values ?? []).filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}

function definitionBySlug(slug: string | null | undefined): ConvenienceRetailerDefinition | null {
  if (!slug) return null;
  const normalized = normalize(slug);
  return CONVENIENCE_RETAILERS.find(retailer => normalize(retailer.slug) === normalized) ?? null;
}

function definitionForText(value: string, allowContainedAlias: boolean): ConvenienceRetailerDefinition | null {
  const candidate = normalize(value);
  if (!candidate) return null;

  for (const retailer of CONVENIENCE_RETAILERS) {
    const names = [retailer.name, retailer.companyName, ...retailer.aliases];
    for (const name of names) {
      const alias = normalize(name);
      if (candidate === alias) return retailer;
      // Two-character Chinese aliases and "OK" are too ambiguous in prose.
      if (allowContainedAlias && alias.length >= 3 && candidate.includes(alias)) return retailer;
    }
  }
  return null;
}

function definitionForOfficialUrl(value: string): ConvenienceRetailerDefinition | null {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return CONVENIENCE_RETAILERS.find(retailer =>
      retailer.officialDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)),
    ) ?? null;
  } catch {
    return null;
  }
}

function identity(
  retailer: ConvenienceRetailerDefinition,
  retailerConfidence: RetailerConfidence,
  retailerEvidence: RetailerEvidence,
  retailerReasonZh: string,
): RetailerIdentity {
  return {
    retailerName: retailer.name,
    retailerSlug: retailer.slug,
    retailerConfidence,
    retailerEvidence,
    retailerReasonZh,
  };
}

export function isRestrictedCirculationBarcode(barcode: string | null | undefined): boolean {
  const digits = (barcode ?? "").replace(/\D/g, "");
  // GS1 Taiwan reserves 02, 04 and 20-29 ranges for restricted/internal use.
  return digits.length === 13 && /^(02|04|2\d)/.test(digits);
}

export function resolveConvenienceRetailer(input: RetailerIdentityInput): RetailerIdentity {
  const explicitSlug = definitionBySlug(input.explicitRetailerSlug);
  if (explicitSlug) {
    return identity(explicitSlug, "confirmed", "retailer_record", "商品紀錄已明確連結此販售通路。");
  }

  if (input.explicitRetailerName) {
    const explicitName = definitionForText(input.explicitRetailerName, true);
    if (explicitName) {
      return identity(explicitName, "confirmed", "retailer_record", "商品紀錄已明確標示此販售通路。");
    }
  }

  for (const sourceUrl of nonEmpty(input.sourceUrls)) {
    const retailer = definitionForOfficialUrl(sourceUrl);
    if (retailer) {
      return identity(retailer, "confirmed", "official_catalog", "商品身分來自該便利商店的官方網站或商品目錄。");
    }
  }

  for (const value of nonEmpty(input.sourceNames)) {
    const retailer = definitionForText(value, false);
    if (retailer) {
      return identity(retailer, "strong", "official_catalog", "商品來源名稱與此便利商店相符。");
    }
  }

  for (const value of nonEmpty(input.brandNames)) {
    const retailer = definitionForText(value, true);
    if (retailer) {
      return identity(retailer, "strong", "package_or_brand", "包裝上的品牌或業者名稱可對應此便利商店。");
    }
  }

  for (const value of [...nonEmpty(input.productNames), ...nonEmpty(input.packageText)]) {
    const retailer = definitionForText(value, true);
    if (retailer) {
      return identity(retailer, "strong", "package_or_brand", "商品名稱或包裝文字可對應此便利商店。");
    }
  }

  if (isRestrictedCirculationBarcode(input.barcode)) {
    return {
      retailerName: null,
      retailerSlug: null,
      retailerConfidence: "unknown",
      retailerEvidence: "restricted_barcode_only",
      retailerReasonZh: "這是可能的店內／限制流通碼；同一號碼可能在不同系統重複，必須再看包裝或通路商品目錄，不能只靠前綴猜店家。",
    };
  }

  return {
    retailerName: null,
    retailerSlug: null,
    retailerConfidence: "unknown",
    retailerEvidence: "unknown",
    retailerReasonZh: "條碼可用來找商品，但不會直接寫出購買通路；目前還缺官方商品目錄或包裝上的便利商店標示。",
  };
}

export function getConvenienceRetailerBySlug(slug: string | null | undefined): ConvenienceRetailerDefinition | null {
  return definitionBySlug(slug);
}

export function getConvenienceRetailerSearchTerms(slug: string | null | undefined): string[] {
  const retailer = definitionBySlug(slug);
  if (!retailer) return [];
  return [...new Set([retailer.name, retailer.companyName, ...retailer.aliases])];
}
