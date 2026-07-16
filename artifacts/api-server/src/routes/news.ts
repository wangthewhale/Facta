import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { productsTable, brandsTable, productNewsTable } from "@workspace/db";
import { GetProductNewsParams } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

/** Cache news results for 7 days to limit web-search billing. */
const NEWS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface NewsArticle {
  title: string;
  url: string | null;
  reportType: "news" | "advertorial" | "press_release" | "unknown";
}

function newsToApi(row: typeof productNewsTable.$inferSelect) {
  return {
    sentiment: row.sentiment,
    summary: row.summary,
    summaryZh: row.summaryZh,
    articles: (row.articles ?? []) as NewsArticle[],
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

router.get("/products/:id/news", async (req, res): Promise<void> => {
  const params = GetProductNewsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  // Cached & fresh?
  const [cached] = await db.select().from(productNewsTable)
    .where(eq(productNewsTable.productId, product.id));
  if (cached && Date.now() - cached.fetchedAt.getTime() < NEWS_TTL_MS) {
    res.json(newsToApi(cached));
    return;
  }

  const [brand] = product.brandId
    ? await db.select().from(brandsTable).where(eq(brandsTable.id, product.brandId))
    : [null];

  const subject = [
    brand?.nameZh || brand?.name,
    product.nameZh || product.name,
  ].filter(Boolean).join(" ");

  try {
    const response = await (openai as any).responses.create({
      model: "gpt-5.6-sol",
      tools: [{ type: "web_search" }],
      input: `Search for recent news (last 2 years) about the Taiwanese food company/brand and product: "${subject}".
Focus on: food safety incidents, recalls, contamination, lawsuits, regulatory violations (negative), OR awards, certifications, health endorsements (positive).

CRITICAL — classify each article's editorial independence:
- "advertorial": paid/sponsored content (廣編稿、業配、廣編特輯、專輯企劃、品牌專區、贊助內容, "sponsored", "in partnership with", brand-supplied quotes with no independent sourcing, uncritical promotional tone)
- "press_release": company press release or lightly rewritten PR (新聞稿, wire-style announcements, company-hosted pages)
- "news": independent journalism (fact-checked reporting, named journalist, independent sources, critical distance)
- "unknown": cannot determine
Base the overall sentiment ONLY on independent journalism and verifiable official records (government agencies, courts, certification bodies). Advertorials and press releases must NOT count as positive evidence — mention them only as articles with their classification.

Respond ONLY with a JSON object:
{
  "sentiment": "positive" | "negative" | "mixed" | "neutral" | "none",
  "summary": "1-3 sentence English summary of key findings from independent sources, or null if nothing notable",
  "summaryZh": "繁體中文摘要（1-3句，僅根據公正報導與官方紀錄），若無值得注意的新聞則為 null",
  "articles": [{"title": "headline", "url": "link or null", "reportType": "news" | "advertorial" | "press_release" | "unknown"}]
}
Use "none" if no relevant independent news found. Do not invent news. Max 5 articles.`,
    });

    const text: string = (response as any).output_text ?? "";
    let parsed: any = { sentiment: "none", summary: null, summaryZh: null, articles: [] };
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch { /* keep default */ }

    const sentiment = ["positive", "negative", "mixed", "neutral", "none"].includes(parsed.sentiment)
      ? parsed.sentiment : "none";
    const articles: NewsArticle[] = Array.isArray(parsed.articles)
      ? parsed.articles.slice(0, 5).map((a: any) => ({
          title: String(a?.title ?? "").slice(0, 300),
          url: typeof a?.url === "string" && /^https?:\/\//i.test(a.url) ? a.url : null,
          reportType: ["news", "advertorial", "press_release", "unknown"].includes(a?.reportType) ? a.reportType : "unknown",
        })).filter((a: NewsArticle) => a.title)
      : [];

    const values = {
      productId: product.id,
      sentiment,
      summary: typeof parsed.summary === "string" ? parsed.summary : null,
      summaryZh: typeof parsed.summaryZh === "string" ? parsed.summaryZh : null,
      articles,
      fetchedAt: new Date(),
    };

    const [saved] = await db.insert(productNewsTable).values(values)
      .onConflictDoUpdate({ target: productNewsTable.productId, set: values })
      .returning();

    res.json(newsToApi(saved));
  } catch (err) {
    req.log.warn({ err }, "News search unavailable");
    // Serve stale cache if present, otherwise an honest empty result (not an error —
    // absence of news intelligence should not break the report page)
    if (cached) { res.json(newsToApi(cached)); return; }
    res.json({ sentiment: "none", summary: null, summaryZh: null, articles: [], fetchedAt: null });
  }
});

export default router;
