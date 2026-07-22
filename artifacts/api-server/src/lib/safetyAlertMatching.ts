export interface ProductSafetyIdentity {
  barcode?: string | null;
  productNames: string[];
  businessNames: string[];
}

export interface SafetyAlertItemIdentity {
  businessName: string;
  matchKeywords: string[];
  productExamples: string[];
}

export interface SafetyAlertMatchDecision {
  matchScope: "exact_product" | "business";
  affectsProduct: true | null;
  matchedKeyword: string;
  matchedProductExample: string | null;
  statusZh: string;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function comparableMatch(left: string, right: string, minContainedLength: number): boolean {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= minContainedLength && (a.includes(b) || b.includes(a));
}

/**
 * Match an official alert without turning every product from the same retailer
 * into an affected SKU. Business-level evidence stays explicitly uncertain;
 * only an example naming this product or barcode may set affectsProduct=true.
 */
export function matchSafetyAlertItem(
  product: ProductSafetyIdentity,
  item: SafetyAlertItemIdentity,
): SafetyAlertMatchDecision | null {
  const businessTerms = [item.businessName, ...item.matchKeywords].filter(term => normalize(term).length >= 2);
  const matchedBusinessKeyword = businessTerms.find(keyword =>
    product.businessNames.some(name => comparableMatch(name, keyword, 2)),
  ) ?? null;

  const barcodeExample = product.barcode
    ? item.productExamples.find(example => normalize(example).includes(normalize(product.barcode!))) ?? null
    : null;
  const nameExample = matchedBusinessKeyword
    ? item.productExamples.find(example => product.productNames.some(name => comparableMatch(name, example, 4))) ?? null
    : null;
  const exactProductExample = barcodeExample ?? nameExample;

  if (exactProductExample) {
    return {
      matchScope: "exact_product",
      affectsProduct: true,
      matchedKeyword: exactProductExample,
      matchedProductExample: exactProductExample,
      statusZh: "官方名單中的品項名稱或條碼可直接對應這款商品；請先停止食用並核對批號與退貨方式。",
    };
  }

  if (matchedBusinessKeyword) {
    return {
      matchScope: "business",
      affectsProduct: null,
      matchedKeyword: matchedBusinessKeyword,
      matchedProductExample: null,
      statusZh: "同品牌、業者或販售通路曾出現在官方事件資料中，但目前沒有證據證明這個條碼商品就是受影響品項。",
    };
  }

  return null;
}
