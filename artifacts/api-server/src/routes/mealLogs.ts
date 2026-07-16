import { Router, type IRouter } from "express";
import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { mealLogsTable, productsTable, productEvaluationsTable } from "@workspace/db";
import { ListMealLogsQueryParams, AddMealLogBody, DeleteMealLogParams } from "@workspace/api-zod";

const router: IRouter = Router();

async function logToApi(log: typeof mealLogsTable.$inferSelect) {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, log.productId));
  const [evalRow] = await db.select({ overallScore: productEvaluationsTable.overallScore, scoreGrade: productEvaluationsTable.scoreGrade })
    .from(productEvaluationsTable).where(eq(productEvaluationsTable.productId, log.productId))
    .orderBy(desc(productEvaluationsTable.evaluatedAt)).limit(1);

  return {
    id: log.id,
    sessionId: log.sessionId,
    productId: log.productId,
    mealType: log.mealType,
    dateStr: log.dateStr,
    loggedAt: log.loggedAt.toISOString(),
    note: log.note,
    productName: product?.name ?? null,
    productNameZh: product?.nameZh ?? null,
    imageUrl: product?.imageUrl ?? null,
    overallScore: evalRow?.overallScore ?? null,
    scoreGrade: evalRow?.scoreGrade ?? null,
  };
}

router.get("/meal-logs", async (req, res): Promise<void> => {
  const parsed = ListMealLogsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { session_id, date_str } = parsed.data;

  const conditions = [
    eq(mealLogsTable.sessionId, session_id),
    isNull(mealLogsTable.deletedAt),
  ];
  if (date_str) conditions.push(eq(mealLogsTable.dateStr, date_str));

  const logs = await db.select().from(mealLogsTable)
    .where(and(...conditions))
    .orderBy(mealLogsTable.loggedAt);

  const result = await Promise.all(logs.map(logToApi));
  res.json(result);
});

router.post("/meal-logs", async (req, res): Promise<void> => {
  const parsed = AddMealLogBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [log] = await db.insert(mealLogsTable).values({
    sessionId: parsed.data.sessionId,
    productId: parsed.data.productId,
    mealType: parsed.data.mealType,
    dateStr: parsed.data.dateStr,
    note: parsed.data.note ?? null,
  }).returning();

  res.status(201).json(await logToApi(log));
});

router.delete("/meal-logs/:id", async (req, res): Promise<void> => {
  const params = DeleteMealLogParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  await db.update(mealLogsTable).set({ deletedAt: new Date() })
    .where(eq(mealLogsTable.id, params.data.id));

  res.json({ ok: true });
});

export default router;
