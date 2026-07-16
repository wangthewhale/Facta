import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { scanEventsTable, productsTable, productEvaluationsTable } from "@workspace/db";
import { GetScanHistoryQueryParams, RecordScanBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/scan/history", async (req, res): Promise<void> => {
  const parsed = GetScanHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { user_session, limit = 20 } = parsed.data;

  const rows = await db.select().from(scanEventsTable)
    .where(eq(scanEventsTable.userSession, user_session))
    .orderBy(desc(scanEventsTable.createdAt))
    .limit(limit);

  const events = await Promise.all(rows.map(async row => {
    let productName: string | null = null;
    let productScore: number | null = null;
    let productGrade: string | null = null;
    let imageUrl: string | null = null;

    if (row.productId) {
      const [product] = await db.select().from(productsTable).where(eq(productsTable.id, row.productId));
      productName = product?.name ?? null;
      imageUrl = product?.imageUrl ?? null;
      const [evalRow] = await db.select({ overallScore: productEvaluationsTable.overallScore, scoreGrade: productEvaluationsTable.scoreGrade })
        .from(productEvaluationsTable).where(eq(productEvaluationsTable.productId, row.productId))
        .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);
      productScore = evalRow?.overallScore ?? null;
      productGrade = evalRow?.scoreGrade ?? null;
    }

    return {
      id: row.id,
      eventType: row.eventType,
      barcode: row.barcode,
      productId: row.productId,
      productName,
      productScore,
      productGrade,
      imageUrl,
      userSession: row.userSession,
      hasUpdate: row.hasUpdate === "true",
      createdAt: row.createdAt.toISOString(),
    };
  }));

  res.json(events);
});

router.post("/scan/history", async (req, res): Promise<void> => {
  const parsed = RecordScanBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [event] = await db.insert(scanEventsTable).values({
    eventType: parsed.data.eventType,
    barcode: parsed.data.barcode ?? null,
    productId: parsed.data.productId ?? null,
    userSession: parsed.data.userSession ?? null,
  }).returning();

  res.status(201).json({
    id: event.id,
    eventType: event.eventType,
    barcode: event.barcode,
    productId: event.productId,
    productName: null,
    productScore: null,
    productGrade: null,
    imageUrl: null,
    userSession: event.userSession,
    hasUpdate: false,
    createdAt: event.createdAt.toISOString(),
  });
});

export default router;
