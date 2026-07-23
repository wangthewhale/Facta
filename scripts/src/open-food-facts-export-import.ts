import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import {
  OFF_SOURCE_KEY,
  summarizeOpenFoodFactsCandidates,
  transformOpenFoodFactsProduct,
  type OpenFoodFactsCandidate,
  type OpenFoodFactsProduct,
} from "./catalog/openFoodFactsCatalog.js";
import { writeOpenFoodFactsToStaging } from "./open-food-facts-import.js";

export const OFF_EXPORT_URL = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";
const TAIWAN_COUNTRY_TAG = "en:taiwan";

type Options = { writeStaging: boolean; maxSourceRows: number | null };

function parseOptions(argv: string[]): Options {
  const parsed: Options = { writeStaging: false, maxSourceRows: null };
  for (const arg of argv) {
    if (arg === "--write-staging") parsed.writeStaging = true;
    else if (arg === "--dry-run") continue;
    else if (arg.startsWith("--max-source-rows=")) parsed.maxSourceRows = Number(arg.slice(18));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.maxSourceRows != null && (!Number.isInteger(parsed.maxSourceRows) || parsed.maxSourceRows < 1)) {
    throw new Error("--max-source-rows must be a positive integer");
  }
  return parsed;
}

function optional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function numeric(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function cell(columns: string[], index: ReadonlyMap<string, number>, name: string): string | undefined {
  const position = index.get(name);
  return position == null ? undefined : columns[position];
}

export function transformOpenFoodFactsExportLine(
  headerIndex: ReadonlyMap<string, number>,
  line: string,
): OpenFoodFactsProduct | null {
  if (!line.includes(TAIWAN_COUNTRY_TAG)) return null;
  const columns = line.split("\t");
  const countryTags = optional(cell(columns, headerIndex, "countries_tags"))
    ?.split(",").map(tag => tag.trim()).filter(Boolean) ?? [];
  if (!countryTags.includes(TAIWAN_COUNTRY_TAG)) return null;

  const nutriments: Record<string, number> = {};
  for (const field of [
    "energy-kcal_100g", "proteins_100g", "fat_100g", "saturated-fat_100g",
    "trans-fat_100g", "carbohydrates_100g", "sugars_100g", "sodium_100g",
  ]) {
    const value = numeric(cell(columns, headerIndex, field));
    if (value != null) nutriments[field] = value;
  }

  return {
    code: optional(cell(columns, headerIndex, "code")),
    product_name: optional(cell(columns, headerIndex, "product_name")),
    brands: optional(cell(columns, headerIndex, "brands")),
    categories: optional(cell(columns, headerIndex, "categories")),
    quantity: optional(cell(columns, headerIndex, "quantity")),
    image_front_url: optional(cell(columns, headerIndex, "image_url")),
    ingredients_text: optional(cell(columns, headerIndex, "ingredients_text")),
    nutrition_data_per: optional(cell(columns, headerIndex, "nutrition_data_per")) ?? "100g",
    nutriments,
    countries_tags: countryTags,
    last_modified_t: numeric(cell(columns, headerIndex, "last_modified_t")),
  };
}

function exportFingerprint(response: Response): string {
  return createHash("sha256").update([
    response.headers.get("etag") ?? "",
    response.headers.get("last-modified") ?? "",
    response.headers.get("content-length") ?? "",
    OFF_EXPORT_URL,
  ].join("|")).digest("hex");
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const response = await fetch(OFF_EXPORT_URL, {
    headers: { "User-Agent": "FACTA/1.0 (https://facta.replit.app; Taiwan export bootstrap importer)" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) throw new Error(`Open Food Facts export failed: HTTP ${response.status}`);

  const candidates = new Map<string, OpenFoodFactsCandidate>();
  const rejected: Array<{ code: string | null; error: string }> = [];
  let headerIndex: Map<string, number> | null = null;
  let scannedRows = 0;
  let taiwanRows = 0;
  const input = Readable.fromWeb(response.body as never).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!headerIndex) {
      headerIndex = new Map(line.split("\t").map((name, index) => [name, index]));
      for (const required of ["code", "product_name", "countries_tags"]) {
        if (!headerIndex.has(required)) throw new Error(`Open Food Facts export is missing ${required}`);
      }
      continue;
    }
    scannedRows += 1;
    if (options.maxSourceRows != null && scannedRows > options.maxSourceRows) break;
    if (scannedRows % 500_000 === 0) {
      process.stderr.write(`scanned=${scannedRows} taiwan=${taiwanRows} accepted=${candidates.size}\n`);
    }
    const product = transformOpenFoodFactsExportLine(headerIndex, line);
    if (!product) continue;
    taiwanRows += 1;
    try {
      const candidate = transformOpenFoodFactsProduct(product);
      candidates.set(candidate.gtin, candidate);
    } catch (error) {
      rejected.push({
        code: product.code ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const accepted = [...candidates.values()];
  const fingerprint = exportFingerprint(response);
  const summary = summarizeOpenFoodFactsCandidates(accepted);
  const output: Record<string, unknown> = {
    mode: options.writeStaging ? "write_staging" : "dry_run",
    source: OFF_SOURCE_KEY,
    sourceUrl: OFF_EXPORT_URL,
    exportEtag: response.headers.get("etag"),
    exportLastModified: response.headers.get("last-modified"),
    scannedRows,
    taiwanRows,
    rejected: rejected.length,
    rejectedSample: rejected.slice(0, 5),
    ...summary,
    positiveBuyEligible: 0,
    safetyRule: "Daily export rows remain unverified candidates and can never receive a positive buy recommendation automatically.",
  };
  if (options.writeStaging) {
    output.database = await writeOpenFoodFactsToStaging({
      candidates: accepted,
      payloadSha256: fingerprint,
      rejectedCount: rejected.length,
      sourceUrl: OFF_EXPORT_URL,
    });
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
