export const RETRACTION_WATCH_CSV_URL = "https://gitlab.com/api/v4/projects/crossref%2Fretraction-watch-data/repository/files/retraction_watch.csv/raw?ref=main";

export interface RetractionWatchRecord {
  recordId: string;
  originalPaperDoi: string | null;
  originalPaperPmid: string | null;
  retractionNature: string;
  retractionDate: string | null;
  reason: string | null;
}

export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function value(row: string[], headers: Map<string, number>, name: string): string | null {
  const index = headers.get(name);
  const result = index == null ? null : row[index]?.trim();
  return result || null;
}

export function parseRetractionWatchCsv(input: string): { records: RetractionWatchRecord[]; rejected: number } {
  const rows = parseCsvRows(input);
  const header = rows.shift() ?? [];
  const headers = new Map(header.map((name, index) => [name.trim(), index]));
  for (const required of ["Record ID", "OriginalPaperDOI", "OriginalPaperPubMedID", "RetractionNature"]) {
    if (!headers.has(required)) throw new Error(`Retraction Watch CSV is missing ${required}`);
  }
  const records: RetractionWatchRecord[] = [];
  let rejected = 0;
  for (const row of rows) {
    const recordId = value(row, headers, "Record ID");
    const nature = value(row, headers, "RetractionNature");
    const rawDoi = value(row, headers, "OriginalPaperDOI");
    const rawPmid = value(row, headers, "OriginalPaperPubMedID");
    const doi = rawDoi && !/^unavailable$/i.test(rawDoi) ? rawDoi.toLowerCase() : null;
    const pmid = rawPmid && rawPmid !== "0" ? rawPmid : null;
    if (!recordId || !nature || (!doi && !pmid)) {
      rejected += 1;
      continue;
    }
    records.push({
      recordId,
      originalPaperDoi: doi,
      originalPaperPmid: pmid,
      retractionNature: nature,
      retractionDate: value(row, headers, "RetractionDate"),
      reason: value(row, headers, "Reason"),
    });
  }
  return { records, rejected };
}

export function integrityStatusForNature(nature: string): "retracted" | "expression_of_concern" | "corrected" | "unchecked" {
  const normalized = nature.toLowerCase();
  if (normalized.includes("retraction")) return "retracted";
  if (normalized.includes("expression of concern")) return "expression_of_concern";
  if (normalized.includes("correction")) return "corrected";
  return "unchecked";
}

export function collapseIntegrityRecords(records: RetractionWatchRecord[]) {
  const precedence = { retracted: 3, expression_of_concern: 2, corrected: 1, unchecked: 0 } as const;
  const collapsed = new Map<string, RetractionWatchRecord & { integrityStatus: keyof typeof precedence }>();
  for (const record of records) {
    const key = record.originalPaperDoi ? `doi:${record.originalPaperDoi}` : `pmid:${record.originalPaperPmid}`;
    const integrityStatus = integrityStatusForNature(record.retractionNature);
    const existing = collapsed.get(key);
    if (!existing || precedence[integrityStatus] > precedence[existing.integrityStatus]) {
      collapsed.set(key, { ...record, integrityStatus });
    }
  }
  return [...collapsed.values()];
}
