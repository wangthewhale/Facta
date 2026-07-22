const TFDA_OIL_RECALL_URL = "https://www.fda.gov.tw/EdibleOilOperator/index.aspx";
const FORM_CACHE_MS = 5 * 60 * 1000;
const RESULT_CACHE_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 9_000;

export interface TfdaOilRecallRow {
  businessName: string;
  city: string;
  productName: string;
  batch: string | null;
  expiry: string | null;
  note: string | null;
}

export interface TfdaOilRecallResult {
  sourceUrl: string;
  lastUpdated: string | null;
  rows: TfdaOilRecallRow[];
}

type FormState = {
  expiresAt: number;
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
  cookie: string;
};

let formState: FormState | null = null;
const resultCache = new Map<string, { expiresAt: number; value: TfdaOilRecallResult }>();

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function nullableCell(value: string): string | null {
  const normalized = decodeHtml(value);
  return normalized && normalized !== "-" ? normalized : null;
}

export function parseTfdaOilRecallHtml(html: string): TfdaOilRecallResult {
  const tbody = html.match(/<tbody[^>]*id=["']rows["'][^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
  const rows: TfdaOilRecallRow[] = [];
  for (const rowMatch of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match => match[1]);
    if (cells.length < 7) continue;
    const businessName = decodeHtml(cells[1]);
    const productName = decodeHtml(cells[3]);
    if (!businessName || !productName) continue;
    rows.push({
      businessName,
      city: decodeHtml(cells[2]),
      productName,
      batch: nullableCell(cells[4]),
      expiry: nullableCell(cells[5]),
      note: nullableCell(cells[6]),
    });
    if (rows.length >= 100) break;
  }

  const updated = html.match(/最後更新[：:]\s*(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  const lastUpdated = updated
    ? `${updated[1]}-${updated[2].padStart(2, "0")}-${updated[3].padStart(2, "0")}T${(updated[4] ?? "00").padStart(2, "0")}:${updated[5] ?? "00"}:00+08:00`
    : null;

  return { sourceUrl: TFDA_OIL_RECALL_URL, lastUpdated, rows };
}

function hiddenValue(html: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']*)["']`, "i"))?.[1] ?? "";
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getFormState(): Promise<FormState> {
  if (formState && formState.expiresAt > Date.now()) return formState;
  const response = await fetchWithTimeout(TFDA_OIL_RECALL_URL, {
    headers: { "User-Agent": "FACTA/1.0 official food-safety lookup (https://facta.replit.app)" },
  });
  if (!response.ok) throw new Error(`TFDA oil recall form HTTP ${response.status}`);
  const html = await response.text();
  const next = {
    expiresAt: Date.now() + FORM_CACHE_MS,
    viewState: hiddenValue(html, "__VIEWSTATE"),
    viewStateGenerator: hiddenValue(html, "__VIEWSTATEGENERATOR"),
    eventValidation: hiddenValue(html, "__EVENTVALIDATION"),
    cookie: response.headers.get("set-cookie") ?? "",
  };
  if (!next.viewState || !next.eventValidation) throw new Error("TFDA oil recall form tokens missing");
  formState = next;
  return next;
}

function productQueries(names: string[]): string[] {
  const queries = new Set<string>();
  for (const rawName of names) {
    const name = rawName.normalize("NFKC").trim().slice(0, 120);
    if (!name) continue;
    queries.add(name);
    const core = name
      .replace(/(?:7[\s-]*ELEVEN|7[\s-]*11|Family\s*Mart|Hi[\s-]*Life|OK\s*mart|統一超商|全家便利商店|全家|萊爾富|OK超商)/gi, " ")
      .replace(/[（(][^）)]*[）)]/g, " ")
      .replace(/\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (core.length >= 4) queries.add(core);
    if (queries.size >= 3) break;
  }
  return [...queries].slice(0, 3);
}

async function queryProduct(productName: string): Promise<TfdaOilRecallResult> {
  const key = productName.toLowerCase();
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const state = await getFormState();
  const body = new URLSearchParams({
    __VIEWSTATE: state.viewState,
    __VIEWSTATEGENERATOR: state.viewStateGenerator,
    __EVENTVALIDATION: state.eventValidation,
    txtSOwnerName: "",
    txtSItem: productName,
    txtSKeyword: "",
    btnSearch: "搜尋",
  });
  const response = await fetchWithTimeout(TFDA_OIL_RECALL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "FACTA/1.0 official food-safety lookup (https://facta.replit.app)",
      ...(state.cookie ? { Cookie: state.cookie } : {}),
    },
    body,
  });
  if (!response.ok) throw new Error(`TFDA oil recall query HTTP ${response.status}`);
  const value = parseTfdaOilRecallHtml(await response.text());
  if (resultCache.size >= 500) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(key, { expiresAt: Date.now() + RESULT_CACHE_MS, value });
  return value;
}

export async function lookupTfdaOilRecallByProduct(
  productNames: string[],
  businessNames: string[] = [],
): Promise<TfdaOilRecallResult> {
  const queries = productQueries(productNames);
  if (queries.length === 0) return { sourceUrl: TFDA_OIL_RECALL_URL, lastUpdated: null, rows: [] };
  try {
    const results = await Promise.all(queries.map(async query => ({ query, result: await queryProduct(query) })));
    const rows = new Map<string, TfdaOilRecallRow>();
    const normalizedBusinesses = businessNames.map(name =>
      name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""),
    ).filter(name => name.length >= 2);
    for (const { query, result } of results) {
      const normalizedQuery = decodeHtml(query).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      for (const row of result.rows) {
        const normalizedProduct = row.productName.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        const normalizedBusiness = row.businessName.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        const businessAligned = normalizedBusinesses.some(name =>
          name === normalizedBusiness ||
          (Math.min(name.length, normalizedBusiness.length) >= 2 &&
            (name.includes(normalizedBusiness) || normalizedBusiness.includes(name))),
        );
        const exactAndSpecific = normalizedQuery === normalizedProduct &&
          (normalizedQuery.length >= 6 || businessAligned);
        const sufficientlySpecific = exactAndSpecific ||
          (Math.min(normalizedQuery.length, normalizedProduct.length) >= 8 &&
            (normalizedQuery.includes(normalizedProduct) || normalizedProduct.includes(normalizedQuery)));
        if (!sufficientlySpecific) continue;
        rows.set([row.businessName, row.productName, row.batch, row.expiry].join("|"), row);
      }
    }
    return {
      sourceUrl: TFDA_OIL_RECALL_URL,
      lastUpdated: results.map(({ result }) => result.lastUpdated).filter(Boolean).sort().at(-1) ?? null,
      rows: [...rows.values()],
    };
  } catch (error) {
    console.warn("[FACTA] TFDA oil recall lookup unavailable", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return { sourceUrl: TFDA_OIL_RECALL_URL, lastUpdated: null, rows: [] };
  }
}

export { TFDA_OIL_RECALL_URL };
