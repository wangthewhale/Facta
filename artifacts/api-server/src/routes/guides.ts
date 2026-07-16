import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { guidesTable, guideSourcesTable, goalsTable, auditLogsTable } from "@workspace/db";
import {
  GetGuideParams, ListGuidesQueryParams,
  AdminCreateGuideBody, AdminUpdateGuideParams, AdminUpdateGuideBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function guideToSummary(g: typeof guidesTable.$inferSelect) {
  return {
    id: g.id, slug: g.slug, title: g.title, titleZh: g.titleZh,
    summary: g.summary, summaryZh: g.summaryZh,
    goalId: g.goalId, coverImageUrl: g.coverImageUrl,
    status: g.status, publishedAt: g.publishedAt?.toISOString() ?? null,
  };
}

router.get("/guides", async (req, res): Promise<void> => {
  const parsed = ListGuidesQueryParams.safeParse(req.query);
  const goalSlug = parsed.success ? parsed.data.goal_slug : null;
  const limit = parsed.success ? (parsed.data.limit ?? 10) : 10;

  let goalId: number | undefined;
  if (goalSlug) {
    const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.slug, goalSlug));
    goalId = goal?.id;
  }

  const rows = await db.select().from(guidesTable)
    .where(and(
      eq(guidesTable.status, "published"),
      goalId ? eq(guidesTable.goalId, goalId) : undefined,
    ))
    .orderBy(desc(guidesTable.publishedAt))
    .limit(limit);

  res.json(rows.map(guideToSummary));
});

router.get("/guides/:slug", async (req, res): Promise<void> => {
  const params = GetGuideParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [guide] = await db.select().from(guidesTable).where(eq(guidesTable.slug, params.data.slug));
  if (!guide) { res.status(404).json({ error: "Guide not found" }); return; }

  const sources = await db.select().from(guideSourcesTable)
    .where(eq(guideSourcesTable.guideId, guide.id))
    .orderBy(guideSourcesTable.sortOrder);

  res.json({
    ...guideToSummary(guide),
    bodyZh: guide.bodyZh, body: guide.body,
    limitationsZh: guide.limitationsZh, limitations: guide.limitations,
    sources: sources.map(s => ({ citation: s.citation, url: s.url, publishedYear: s.publishedYear })),
    evidenceLastReviewedAt: guide.evidenceLastReviewedAt?.toISOString() ?? null,
    reviewDueDate: guide.reviewDueDate?.toISOString() ?? null,
  });
});

// Admin
router.post("/admin/guides", async (req, res): Promise<void> => {
  const body = AdminCreateGuideBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [guide] = await db.insert(guidesTable).values({
    slug: body.data.slug ?? "",
    title: body.data.title ?? "",
    titleZh: body.data.titleZh ?? "",
    summaryZh: body.data.summaryZh ?? null,
    bodyZh: body.data.bodyZh ?? null,
    goalId: body.data.goalId ?? null,
    status: body.data.status ?? "draft",
  }).returning();

  await db.insert(auditLogsTable).values({ entityType: "guide", entityId: guide.id, action: "create", newValue: guide });
  res.status(201).json(guideToSummary(guide));
});

router.patch("/admin/guides/:id", async (req, res): Promise<void> => {
  const params = AdminUpdateGuideParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = AdminUpdateGuideBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const updates: Partial<typeof guidesTable.$inferInsert> = { updatedAt: new Date() };
  if (body.data.titleZh !== undefined) updates.titleZh = body.data.titleZh;
  if (body.data.summaryZh !== undefined) updates.summaryZh = body.data.summaryZh;
  if (body.data.bodyZh !== undefined) updates.bodyZh = body.data.bodyZh;
  if (body.data.status !== undefined) {
    updates.status = body.data.status;
    if (body.data.status === "published" && !updates.publishedAt) updates.publishedAt = new Date();
  }
  if (body.data.goalId !== undefined) updates.goalId = body.data.goalId;

  const [updated] = await db.update(guidesTable).set(updates).where(eq(guidesTable.id, params.data.id)).returning();
  if (!updated) { res.status(404).json({ error: "Guide not found" }); return; }

  await db.insert(auditLogsTable).values({ entityType: "guide", entityId: updated.id, action: "update", newValue: updates });
  res.json(guideToSummary(updated));
});

export default router;
