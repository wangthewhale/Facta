/**
 * Retail barcode validation and lookup normalization.
 *
 * The same trade item can be emitted by scanners as UPC-A (12 digits),
 * EAN-13 (the same UPC-A with a leading zero), or a zero-indicator GTIN-14.
 * We search only mathematically equivalent representations; we never infer a
 * product or retailer from a GS1 company prefix.
 */

function validatesCheckDigit(value: string): boolean {
  if (!/^\d+$/.test(value) || value.length < 2) return false;
  const checkDigit = Number(value.at(-1));
  const payload = value.slice(0, -1).split("").map(Number).reverse();
  const sum = payload.reduce(
    (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
    0,
  );
  return (10 - (sum % 10)) % 10 === checkDigit;
}

/** Expand number-system 0/1 UPC-E to the equivalent UPC-A representation. */
export function expandUpcE(value: string): string | null {
  if (!/^\d{8}$/.test(value) || !/^[01]/.test(value)) return null;
  const [numberSystem, d1, d2, d3, d4, d5, d6, check] = value;
  const payload =
    d6 === "0" || d6 === "1" || d6 === "2"
      ? `${numberSystem}${d1}${d2}${d6}0000${d3}${d4}${d5}`
      : d6 === "3"
        ? `${numberSystem}${d1}${d2}${d3}00000${d4}${d5}`
        : d6 === "4"
          ? `${numberSystem}${d1}${d2}${d3}${d4}00000${d5}`
          : `${numberSystem}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  const expanded = `${payload}${check}`;
  return validatesCheckDigit(expanded) ? expanded : null;
}

export function isValidRetailGtin(value: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(value)) return false;
  return validatesCheckDigit(value) || expandUpcE(value) !== null;
}

/** Preferred database key, following Open Food Facts' leading-zero model. */
export function normalizeRetailGtin(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!isValidRetailGtin(digits)) return null;
  const expandedUpcE = expandUpcE(digits);
  if (expandedUpcE) return `0${expandedUpcE}`;
  if (digits.length === 12) return `0${digits}`;
  if (digits.length === 14 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

/**
 * Exact equivalent keys to check in legacy and normalized catalog rows.
 * No fuzzy matching or prefix ownership inference is performed here.
 */
export function retailGtinLookupVariants(value: string): string[] {
  const digits = value.replace(/\D/g, "");
  const canonical = normalizeRetailGtin(digits);
  if (!canonical) return [];
  const variants = new Set<string>([canonical, digits]);
  const expandedUpcE = expandUpcE(digits);
  if (expandedUpcE) variants.add(expandedUpcE);
  if (canonical.length === 13 && canonical.startsWith("0")) variants.add(canonical.slice(1));
  if (canonical.length === 13) variants.add(`0${canonical}`);
  if (canonical.length === 14 && canonical.startsWith("0")) variants.add(canonical.slice(1));
  return [...variants];
}
