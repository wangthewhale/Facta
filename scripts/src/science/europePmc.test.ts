import assert from "node:assert/strict";
import test from "node:test";
import {
  allowsCommercialFullTextReuse,
  attachLicensedFullText,
  buildEuropePmcQuery,
  classifyStudyDesign,
  normalizeEuropePmcResult,
} from "./europePmc.js";

const RANGE_START = "2011-01-01";
const RANGE_END = "2026-07-23";

test("normalizes provenance, design and rights without inventing GRADE certainty", () => {
  const result = normalizeEuropePmcResult({
    id: "123",
    source: "MED",
    pmid: "123",
    pmcid: "PMC123",
    doi: "10.1000/TEST",
    title: "A systematic review of dietary sodium",
    abstractText: "Evidence synthesis.",
    firstPublicationDate: "2022-04-05",
    pubTypeList: { pubType: ["Systematic Review"] },
    isOpenAccess: "Y",
    license: "CC BY",
  }, RANGE_START, RANGE_END);
  assert.equal(result.studyDesign, "systematic_review");
  assert.equal(result.studyDesignRank, 20);
  assert.equal(result.contentReuseStatus, "oa_commercial_reuse");
  assert.equal(result.integrityStatus, "unchecked");
  assert.equal(result.doi, "10.1000/test");
  assert.ok(!("bodyCertainty" in result));
});

test("excludes integrity warnings at ingestion", () => {
  const result = normalizeEuropePmcResult({
    id: "456", source: "MED", title: "Retracted nutrition claim",
    firstPublicationDate: "2019-01-01",
    pubTypeList: { pubType: ["Retracted Publication"] },
  }, RANGE_START, RANGE_END);
  assert.equal(result.integrityStatus, "retracted");
  assert.ok(result.qualityFlags.includes("retracted_exclude_from_consumer_use"));
});

test("keeps animal and in-vitro evidence below human outcome designs", () => {
  assert.deepEqual(classifyStudyDesign([], "A randomized controlled trial"), { studyDesign: "randomized_trial", studyDesignRank: 30 });
  assert.deepEqual(classifyStudyDesign([], "Study in rats"), { studyDesign: "animal", studyDesignRank: 80 });
  assert.deepEqual(classifyStudyDesign([], "Cell line in vitro"), { studyDesign: "in_vitro", studyDesignRank: 85 });
});

test("stores full text only for explicit commercial-compatible OA licenses", () => {
  assert.equal(allowsCommercialFullTextReuse("cc by"), true);
  assert.equal(allowsCommercialFullTextReuse("cc by-nc"), false);
  const source = normalizeEuropePmcResult({
    id: "789", source: "MED", pmcid: "PMC789", title: "Open review",
    firstPublicationDate: "2024-01-01", isOpenAccess: "Y", license: "CC BY",
  }, RANGE_START, RANGE_END);
  const attached = attachLicensedFullText(source, "<article><body><p>Reusable evidence text.</p></body></article>");
  assert.equal(attached.fullTextText, "Reusable evidence text.");
  assert.ok(attached.fullTextSha256);
});

test("builds a bounded 15-year topic query", () => {
  assert.equal(buildEuropePmcQuery({
    canonicalName: "sodium", displayNameZh: "鈉", topicType: "nutrient", queryTerms: ["dietary sodium"],
  }, RANGE_START, RANGE_END), '(TITLE_ABS:"dietary sodium") AND FIRST_PDATE:[2011-01-01 TO 2026-07-23] AND (HUMANS:Y OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Guideline")');
});
