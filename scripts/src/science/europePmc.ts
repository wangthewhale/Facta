import { createHash } from "node:crypto";

export const EUROPE_PMC_API = "https://www.ebi.ac.uk/europepmc/webservices/rest";

export interface EvidenceTopicDefinition {
  canonicalName: string;
  displayNameZh: string;
  topicType: "ingredient" | "additive" | "nutrient" | "diet_pattern" | "health_outcome";
  queryTerms: string[];
}

export const DEFAULT_EVIDENCE_TOPICS: EvidenceTopicDefinition[] = [
  { canonicalName: "added sugar", displayNameZh: "添加糖", topicType: "nutrient", queryTerms: ["added sugar", "sugar sweetened beverage", "free sugars"] },
  { canonicalName: "sodium", displayNameZh: "鈉", topicType: "nutrient", queryTerms: ["dietary sodium", "salt intake"] },
  { canonicalName: "saturated fat", displayNameZh: "飽和脂肪", topicType: "nutrient", queryTerms: ["saturated fat", "saturated fatty acid"] },
  { canonicalName: "trans fat", displayNameZh: "反式脂肪", topicType: "nutrient", queryTerms: ["trans fat", "trans fatty acid", "partially hydrogenated oil"] },
  { canonicalName: "dietary fiber", displayNameZh: "膳食纖維", topicType: "nutrient", queryTerms: ["dietary fiber", "dietary fibre"] },
  { canonicalName: "ultra-processed food", displayNameZh: "超加工食品", topicType: "diet_pattern", queryTerms: ["ultra processed food", "NOVA classification"] },
  { canonicalName: "nitrite and nitrate", displayNameZh: "亞硝酸鹽與硝酸鹽", topicType: "additive", queryTerms: ["dietary nitrite", "dietary nitrate", "processed meat nitrite"] },
  { canonicalName: "non-sugar sweeteners", displayNameZh: "非糖甜味劑", topicType: "additive", queryTerms: ["non sugar sweetener", "artificial sweetener", "aspartame", "sucralose", "acesulfame potassium", "saccharin"] },
  { canonicalName: "food emulsifiers", displayNameZh: "食品乳化劑", topicType: "additive", queryTerms: ["food emulsifier", "dietary emulsifier", "carboxymethylcellulose", "polysorbate 80"] },
  { canonicalName: "carrageenan", displayNameZh: "鹿角菜膠", topicType: "additive", queryTerms: ["carrageenan", "E407"] },
  { canonicalName: "benzoates", displayNameZh: "苯甲酸鹽", topicType: "additive", queryTerms: ["sodium benzoate", "benzoic acid", "benzoate preservative"] },
  { canonicalName: "titanium dioxide", displayNameZh: "二氧化鈦", topicType: "additive", queryTerms: ["food grade titanium dioxide", "titanium dioxide ingestion", "E171"] },
];

export type EuropePmcResult = {
  id?: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  abstractText?: string;
  authorString?: string;
  authorList?: { author?: Array<{ fullName?: string }> };
  journalTitle?: string;
  journalInfo?: {
    printPublicationDate?: string;
    yearOfPublication?: number;
    journal?: { title?: string };
  };
  pubYear?: string;
  firstPublicationDate?: string;
  publicationStatus?: string;
  pubTypeList?: { pubType?: string[] };
  keywordList?: { keyword?: string[] };
  meshHeadingList?: { meshHeading?: Array<{ descriptorName?: string }> };
  isOpenAccess?: string;
  license?: string;
  citedByCount?: number;
  [key: string]: unknown;
};

export interface NormalizedScientificSource {
  provider: "europe_pmc";
  externalId: string;
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  title: string;
  abstractText: string | null;
  abstractSha256: string | null;
  fullTextText: string | null;
  fullTextSha256: string | null;
  journal: string | null;
  publicationDate: string;
  publicationYear: number;
  publicationTypes: string[];
  meshTerms: string[];
  authors: string[];
  sourceUrl: string;
  isOpenAccess: boolean;
  licenseId: string | null;
  contentReuseStatus: "metadata_only" | "abstract_internal_only" | "oa_commercial_reuse" | "oa_noncommercial_only" | "unknown";
  studyDesign: string;
  studyDesignRank: number;
  integrityStatus: "unchecked" | "current" | "corrected" | "expression_of_concern" | "retracted";
  qualityFlags: string[];
  rawMetadata: EuropePmcResult;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedLicense(value: string | null): string | null {
  return value?.toLowerCase().replace(/[_\s]+/g, " ").trim() ?? null;
}

export function allowsCommercialFullTextReuse(license: string | null): boolean {
  const normalized = normalizedLicense(license);
  return normalized === "cc0" || normalized === "cc by" || normalized === "cc by-sa";
}

function contentReuseStatus(result: EuropePmcResult, abstractText: string | null): NormalizedScientificSource["contentReuseStatus"] {
  const isOpenAccess = result.isOpenAccess === "Y";
  const license = clean(result.license);
  if (isOpenAccess && allowsCommercialFullTextReuse(license)) return "oa_commercial_reuse";
  if (isOpenAccess && license) return "oa_noncommercial_only";
  if (abstractText) return "abstract_internal_only";
  return "metadata_only";
}

export function classifyStudyDesign(publicationTypes: string[], titleAndAbstract = "") {
  const haystack = `${publicationTypes.join(" ")} ${titleAndAbstract}`.toLowerCase();
  const options: Array<[RegExp, string, number]> = [
    [/practice guideline|guideline/, "guideline", 10],
    [/systematic review|evidence synthesis/, "systematic_review", 20],
    [/network meta-analysis|meta-analysis/, "meta_analysis", 22],
    [/randomized controlled trial|randomised controlled trial|\brct\b/, "randomized_trial", 30],
    [/controlled clinical trial|clinical trial/, "clinical_trial", 35],
    [/prospective cohort|retrospective cohort|cohort study/, "cohort", 40],
    [/case-control|case control/, "case_control", 45],
    [/cross-sectional|cross sectional/, "cross_sectional", 50],
    [/observational study/, "observational", 55],
    [/scoping review|review/, "review", 60],
    [/case reports?|case series/, "case_report", 70],
    [/\brats?\b|\bmice\b|murine|animal study/, "animal", 80],
    [/in vitro|cell line/, "in_vitro", 85],
    [/preprint/, "preprint", 95],
  ];
  const matched = options.find(([pattern]) => pattern.test(haystack));
  return matched ? { studyDesign: matched[1], studyDesignRank: matched[2] } : { studyDesign: "other", studyDesignRank: 90 };
}

function integrityStatus(publicationTypes: string[]): NormalizedScientificSource["integrityStatus"] {
  const normalized = publicationTypes.map(value => value.toLowerCase());
  if (normalized.some(value => value.includes("retracted publication"))) return "retracted";
  if (normalized.some(value => value.includes("expression of concern"))) return "expression_of_concern";
  if (normalized.some(value => value.includes("corrected and republished") || value.includes("published erratum"))) return "corrected";
  return "unchecked";
}

function publicationDate(result: EuropePmcResult): string | null {
  const direct = clean(result.firstPublicationDate) ?? clean(result.journalInfo?.printPublicationDate);
  if (direct && /^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const year = Number(result.pubYear ?? result.journalInfo?.yearOfPublication);
  return Number.isInteger(year) ? `${year}-01-01` : null;
}

export function normalizeEuropePmcResult(
  result: EuropePmcResult,
  rangeStart: string,
  rangeEnd: string,
): NormalizedScientificSource {
  const id = clean(result.id);
  const source = clean(result.source);
  const title = clean(result.title);
  const date = publicationDate(result);
  if (!id || !source) throw new Error("Europe PMC record has no stable source identifier");
  if (!title) throw new Error("Europe PMC record has no title");
  if (!date || date < rangeStart || date > rangeEnd) throw new Error("Europe PMC record is outside the configured date range");
  const publicationTypes = [...new Set(result.pubTypeList?.pubType?.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? [])];
  const abstractText = clean(result.abstractText);
  const integrity = integrityStatus(publicationTypes);
  const design = classifyStudyDesign(publicationTypes, `${title} ${abstractText ?? ""}`);
  const isOpenAccess = result.isOpenAccess === "Y";
  const license = clean(result.license);
  const authors = result.authorList?.author
    ?.map(author => clean(author.fullName))
    .filter((value): value is string => Boolean(value))
    ?? clean(result.authorString)?.split(/,\s*/).filter(Boolean)
    ?? [];
  const meshTerms = [...new Set([
    ...(result.keywordList?.keyword ?? []),
    ...(result.meshHeadingList?.meshHeading ?? []).map(item => item.descriptorName ?? ""),
  ].map(value => value.trim()).filter(Boolean))];
  const qualityFlags = [
    !abstractText ? "missing_abstract" : null,
    !result.doi ? "missing_doi" : null,
    design.studyDesign === "preprint" ? "preprint_not_peer_reviewed" : null,
    design.studyDesign === "animal" || design.studyDesign === "in_vitro" ? "indirect_nonhuman_evidence" : null,
    integrity === "retracted" ? "retracted_exclude_from_consumer_use" : null,
    integrity === "expression_of_concern" ? "expression_of_concern_exclude_from_consumer_use" : null,
    isOpenAccess && !license ? "open_access_license_not_machine_readable" : null,
  ].filter((value): value is string => Boolean(value));
  return {
    provider: "europe_pmc",
    externalId: `${source}:${id}`,
    pmid: clean(result.pmid) ?? (source === "MED" ? id : null),
    pmcid: clean(result.pmcid),
    doi: clean(result.doi)?.toLowerCase() ?? null,
    title,
    abstractText,
    abstractSha256: abstractText ? sha256(abstractText) : null,
    fullTextText: null,
    fullTextSha256: null,
    journal: clean(result.journalInfo?.journal?.title) ?? clean(result.journalTitle),
    publicationDate: date,
    publicationYear: Number(date.slice(0, 4)),
    publicationTypes,
    meshTerms,
    authors,
    sourceUrl: `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
    isOpenAccess,
    licenseId: license,
    contentReuseStatus: contentReuseStatus(result, abstractText),
    studyDesign: design.studyDesign,
    studyDesignRank: design.studyDesignRank,
    integrityStatus: integrity,
    qualityFlags,
    rawMetadata: result,
  };
}

function quotedTerm(value: string): string {
  return `"${value.replace(/["\\]/g, " ").trim()}"`;
}

export function buildEuropePmcQuery(
  topic: EvidenceTopicDefinition,
  rangeStart: string,
  rangeEnd: string,
  includePreclinical = false,
): string {
  // Search title/abstract rather than every full-text mention. The default
  // corpus is human consumer evidence plus evidence syntheses/guidelines;
  // preclinical records can be collected in a separate reference-only pass.
  const sourceTerms = topic.queryTerms.length ? topic.queryTerms : [topic.canonicalName];
  const terms = [...new Set(sourceTerms)].map(term => `TITLE_ABS:${quotedTerm(term)}`).join(" OR ");
  const consumerEvidence = '(HUMANS:Y OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Guideline")';
  return `(${terms}) AND FIRST_PDATE:[${rangeStart} TO ${rangeEnd}]${includePreclinical ? "" : ` AND ${consumerEvidence}`}`;
}

export function attachLicensedFullText(source: NormalizedScientificSource, xml: string): NormalizedScientificSource {
  if (!source.pmcid || source.contentReuseStatus !== "oa_commercial_reuse") return source;
  const plain = xml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return source;
  return { ...source, fullTextText: plain, fullTextSha256: sha256(plain) };
}
