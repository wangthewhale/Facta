import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { productsTable, brandsTable, productNewsTable } from "@workspace/db";
import { GetProductNewsParams } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

/** Product news should feel current; stale data is labelled instead of silently reused. */
const NEWS_TTL_MS = 24 * 60 * 60 * 1000;
const NEWS_LOOKBACK_DAYS = 365;

type ReportType = "news" | "official_record" | "advertorial" | "press_release" | "unknown";
type NewsScope = "product" | "brand" | "company";
type NewsStatus = "fresh" | "cached" | "stale" | "no_results" | "unavailable";

interface NewsArticle {
  title: string;
  url: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  reportType: ReportType;
  scope: NewsScope;
  affectsProduct: boolean | null;
}

interface CuratedBrandNews {
  brandAliases: string[];
  sentiment: "negative" | "mixed" | "neutral";
  summary: string;
  summaryZh: string;
  article: NewsArticle;
}

/**
 * Small, source-verified registry for high-impact current events that must not
 * disappear when the live search provider is slow. Entries remain explicitly
 * dated and scoped; they complement, rather than replace, the live search.
 * Every entry requires a directly reviewable article URL and an explicit note
 * about whether the event affects the exact product or only its brand.
 */
const CURATED_BRAND_NEWS: CuratedBrandNews[] = [{
  brandAliases: ["愛之味", "agv"],
  sentiment: "negative",
  summary: "On July 16, 2026, independent reporting said AGV recalled specified batches of Preserved Bamboo Shoots and Vegetarian Satay Sauce after an upstream oil issue. The report states that other AGV products were not affected; this is a brand-level event and does not implicate this exact product.",
  summaryZh: "2026 年 7 月 16 日獨立報導指出，愛之味因上游問題油回收「珍保玉筍」與「素食沙茶醬」指定批號；報導同時指出其他愛之味商品未受影響。這是品牌層級事件，未指向本款商品。",
  article: {
    title: "用到致癌油！愛之味「2產品」急下架　批號、退貨辦法一次看",
    url: "https://news.tvbs.com.tw/life/3259103?from=politics_extend",
    sourceName: "TVBS 新聞網",
    publishedAt: "2026-07-16",
    reportType: "news",
    scope: "brand",
    affectsProduct: false,
  },
}];

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[\s\-_·・|｜]/g, "");
}

function curatedNewsForBrand(brandNames: string[]): CuratedBrandNews | null {
  const normalizedBrands = brandNames.map(normalizedText);
  return CURATED_BRAND_NEWS.find(item => item.brandAliases.some(alias => {
    const normalizedAlias = normalizedText(alias);
    return normalizedBrands.some(brand => brand.includes(normalizedAlias) || normalizedAlias.includes(brand));
  })) ?? null;
}

function validPublishedDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) return null;
  const time = Date.parse(match[0]);
  const now = Date.now();
  if (!Number.isFinite(time) || time > now + 24 * 60 * 60 * 1000) return null;
  if (time < now - 2 * 365 * 24 * 60 * 60 * 1000) return null;
  return match[0];
}

function sanitizeArticles(value: unknown): NewsArticle[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const articles: NewsArticle[] = [];

  for (const raw of value) {
    const item = raw as Record<string, unknown>;
    const title = typeof item?.title === "string" ? item.title.trim().slice(0, 300) : "";
    if (!title) continue;
    const url = typeof item.url === "string" && /^https?:\/\//i.test(item.url) ? item.url : null;
    const key = (url || title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const reportType: ReportType = ["news", "official_record", "advertorial", "press_release", "unknown"].includes(String(item.reportType))
      ? item.reportType as ReportType : "unknown";
    const scope: NewsScope = ["product", "brand", "company"].includes(String(item.scope))
      ? item.scope as NewsScope : "brand";

    articles.push({
      title,
      url,
      sourceName: typeof item.sourceName === "string" && item.sourceName.trim()
        ? item.sourceName.trim().slice(0, 120) : null,
      publishedAt: validPublishedDate(item.publishedAt),
      reportType,
      scope,
      affectsProduct: typeof item.affectsProduct === "boolean" ? item.affectsProduct : null,
    });
    if (articles.length >= 8) break;
  }

  return articles.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}

function newsToApi(
  row: typeof productNewsTable.$inferSelect,
  status: NewsStatus,
  query: string,
) {
  return {
    sentiment: row.sentiment,
    status,
    query,
    lookbackDays: NEWS_LOOKBACK_DAYS,
    summary: row.summary,
    summaryZh: row.summaryZh,
    articles: sanitizeArticles(row.articles),
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

router.get("/products/:id/news", async (req, res): Promise<void> => {
  const params = GetProductNewsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const [brand] = product.brandId
    ? await db.select().from(brandsTable).where(eq(brandsTable.id, product.brandId))
    : [null];

  const productNames = [...new Set([product.nameZh, product.name].filter(Boolean))] as string[];
  const brandNames = [...new Set([brand?.nameZh, brand?.name].filter(Boolean))] as string[];
  const productLabel = productNames[0] || `product ${product.id}`;
  const brandLabel = brandNames[0] || "unknown brand";
  const query = `${brandLabel}｜${productLabel}`;

  const [cached] = await db.select().from(productNewsTable)
    .where(eq(productNewsTable.productId, product.id));
  const curated = curatedNewsForBrand(brandNames);
  const cachedArticles = sanitizeArticles(cached?.articles);

  // A newly verified high-impact event takes precedence over an older cache.
  if (curated && !cachedArticles.some(article => article.url === curated.article.url)) {
    const values = {
      productId: product.id,
      sentiment: curated.sentiment,
      summary: curated.summary,
      summaryZh: curated.summaryZh,
      articles: sanitizeArticles([curated.article, ...cachedArticles]),
      fetchedAt: new Date(),
    };
    const [saved] = await db.insert(productNewsTable).values(values)
      .onConflictDoUpdate({ target: productNewsTable.productId, set: values })
      .returning();
    res.json(newsToApi(saved, "fresh", query));
    return;
  }

  if (cached && Date.now() - cached.fetchedAt.getTime() < NEWS_TTL_MS) {
    res.json(newsToApi(cached, cachedArticles.length === 0 && cached.sentiment === "none" ? "no_results" : "cached", query));
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const searchController = new AbortController();
    const searchTimeout = setTimeout(() => searchController.abort(), 25_000);
    let response: any;
    try {
      response = await (openai as any).responses.create({
        model: "gpt-5.6-sol",
        tools: [{ type: "web_search" }],
        input: `Today is ${today}. Find the newest relevant reporting from the last ${NEWS_LOOKBACK_DAYS} days for this Taiwan food product and its owner/brand.

Exact product names: ${productNames.map(name => `"${name}"`).join(", ") || `"${productLabel}"`}
Brand/company names: ${brandNames.map(name => `"${name}"`).join(", ") || `"${brandLabel}"`}

Run separate searches for: (1) the exact product name; (2) the brand/company plus 食安, 回收, 下架, 違規, 污染, 裁罰, 認證, 檢驗; (3) the newest general brand news. Include relevant brand/company incidents even when the exact product is not named, but never imply that the exact product is affected unless a source explicitly says so. Prefer TFDA or other official records and independent journalism. Verify the publication date and original URL. Deduplicate rewritten versions of the same event.

Classify each result:
- reportType "official_record": government, court, regulator, or certification-body record
- reportType "news": independent journalism
- reportType "advertorial": sponsored/paid brand content (廣編、業配、品牌專區、贊助內容)
- reportType "press_release": company release or lightly rewritten PR
- reportType "unknown": cannot determine
- scope "product" only when the exact product is named; otherwise "brand" or "company"
- affectsProduct true only with explicit evidence the exact product is affected; false when sources identify other products; null when unclear

Overall sentiment may use only official_record and news. Absence of negative news is NOT positive evidence. If a serious brand event exists but the exact product is not implicated, reflect the brand-level concern and clearly state the exact product status in both summaries.

Return ONLY one JSON object:
{
  "sentiment": "positive" | "negative" | "mixed" | "neutral" | "none",
  "summary": "1-3 sentence English evidence summary, or null",
  "summaryZh": "1-3 句繁體中文證據摘要，清楚區分商品／品牌層級，或 null",
  "articles": [{
    "title": "headline",
    "url": "original URL or null",
    "sourceName": "publisher/agency or null",
    "publishedAt": "YYYY-MM-DD or null",
    "reportType": "news" | "official_record" | "advertorial" | "press_release" | "unknown",
    "scope": "product" | "brand" | "company",
    "affectsProduct": true | false | null
  }]
}
Return no more than 8 articles. Do not invent a source, date, claim, or URL.`,
      }, { signal: searchController.signal });
    } finally {
      clearTimeout(searchTimeout);
    }

    const outputText: string = (response as any).output_text ?? "";
    let parsed: Record<string, unknown> = {};
    try {
      const first = outputText.indexOf("{");
      const last = outputText.lastIndexOf("}");
      if (first >= 0 && last > first) parsed = JSON.parse(outputText.slice(first, last + 1));
    } catch { /* handled as no verified result */ }

    const articles = sanitizeArticles(parsed.articles);
    const sentiment = ["positive", "negative", "mixed", "neutral", "none"].includes(String(parsed.sentiment))
      ? String(parsed.sentiment) : "none";
    const values = {
      productId: product.id,
      sentiment,
      summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 2000) || null : null,
      summaryZh: typeof parsed.summaryZh === "string" ? parsed.summaryZh.trim().slice(0, 2000) || null : null,
      articles,
      fetchedAt: new Date(),
    };

    const [saved] = await db.insert(productNewsTable).values(values)
      .onConflictDoUpdate({ target: productNewsTable.productId, set: values })
      .returning();

    res.json(newsToApi(saved, articles.length === 0 && sentiment === "none" ? "no_results" : "fresh", query));
  } catch (err) {
    req.log.warn({ err }, "News search unavailable");
    if (cached) { res.json(newsToApi(cached, "stale", query)); return; }
    res.json({
      sentiment: "none",
      status: "unavailable",
      query,
      lookbackDays: NEWS_LOOKBACK_DAYS,
      summary: null,
      summaryZh: null,
      articles: [],
      fetchedAt: null,
    });
  }
});

export default router;
