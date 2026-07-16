import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { userPreferencesTable } from "@workspace/db";
import { GetPreferencesParams, SavePreferencesParams, SavePreferencesBody } from "@workspace/api-zod";

const router: IRouter = Router();

function prefToApi(p: typeof userPreferencesTable.$inferSelect) {
  return {
    sessionId: p.sessionId,
    allergens: (p.allergens as string[]) ?? [],
    dietaryPreferences: (p.dietaryPreferences as string[]) ?? [],
    avoidIngredients: (p.avoidIngredients as string[]) ?? [],
    locale: p.locale ?? "zh-TW",
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.get("/preferences/:sessionId", async (req, res): Promise<void> => {
  const params = GetPreferencesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [pref] = await db.select().from(userPreferencesTable).where(eq(userPreferencesTable.sessionId, params.data.sessionId));
  if (!pref) { res.status(404).json({ error: "Preferences not found" }); return; }

  res.json(prefToApi(pref));
});

router.put("/preferences/:sessionId", async (req, res): Promise<void> => {
  const params = SavePreferencesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = SavePreferencesBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const existing = await db.select().from(userPreferencesTable).where(eq(userPreferencesTable.sessionId, params.data.sessionId));

  let result;
  if (existing.length > 0) {
    const [updated] = await db.update(userPreferencesTable).set({
      allergens: body.data.allergens ?? [],
      dietaryPreferences: body.data.dietaryPreferences ?? [],
      avoidIngredients: body.data.avoidIngredients ?? [],
      locale: body.data.locale ?? "zh-TW",
      updatedAt: new Date(),
    }).where(eq(userPreferencesTable.sessionId, params.data.sessionId)).returning();
    result = updated;
  } else {
    const [created] = await db.insert(userPreferencesTable).values({
      sessionId: params.data.sessionId,
      allergens: body.data.allergens ?? [],
      dietaryPreferences: body.data.dietaryPreferences ?? [],
      avoidIngredients: body.data.avoidIngredients ?? [],
      locale: body.data.locale ?? "zh-TW",
    }).returning();
    result = created;
  }

  res.json(prefToApi(result));
});

export default router;
