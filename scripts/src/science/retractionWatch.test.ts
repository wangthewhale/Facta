import assert from "node:assert/strict";
import test from "node:test";
import { collapseIntegrityRecords, parseRetractionWatchCsv } from "./retractionWatch.js";

const CSV = `Record ID,Title,OriginalPaperDOI,OriginalPaperPubMedID,RetractionNature,RetractionDate,Reason,
1,"A title, with comma",10.1000/ABC,123,Correction,"1/1/2024 0:00","Data note;Other;",
2,"A title with ""quote""",10.1000/ABC,123,Retraction,"2/1/2024 0:00","Unreliable data;",
3,No DOI,,456,Expression of concern,"3/1/2024 0:00",Concern,
4,No identifiers,,,Retraction,"4/1/2024 0:00",Missing,
`;

test("parses quoted Crossref Retraction Watch CSV and rejects unmatchable rows", () => {
  const result = parseRetractionWatchCsv(CSV);
  assert.equal(result.records.length, 3);
  assert.equal(result.rejected, 1);
  assert.equal(result.records[0]?.originalPaperDoi, "10.1000/abc");
});

test("uses the strongest integrity state when records overlap", () => {
  const collapsed = collapseIntegrityRecords(parseRetractionWatchCsv(CSV).records);
  assert.equal(collapsed.find(record => record.originalPaperDoi === "10.1000/abc")?.integrityStatus, "retracted");
  assert.equal(collapsed.find(record => record.originalPaperPmid === "456")?.integrityStatus, "expression_of_concern");
});
