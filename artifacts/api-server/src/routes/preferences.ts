import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { userPreferencesTable } from "@workspace/db";
import { GetPreferencesParams, SavePreferencesParams, SavePreferencesBody } from "@workspace/api-zod";

const router: IRouter = Router();

function prefToApi(p: typeof userPreferencesTable.$inferSelect) {
  return {
    sessionId: p.sessionId,
    displayName: p.displayName ?? null,
    email: p.email ?? null,
    allergens: (p.allergens as string[]) ?? [],
    dietaryPreferences: (p.dietaryPreferences as string[]) ?? [],
    avoidIngredients: (p.avoidIngredients as string[]) ?? [],
    habits: (p.habits as string[]) ?? [],
    notes: p.notes ?? null,
    householdMembers: (p.householdMembers as unknown[]) ?? [],
    personalizationEnabled: p.personalizationEnabled,
    locale: p.locale ?? "zh-TW",
    updatedAt: p.updatedAt.toISOString(),
  };
}

function cleanedText(value: string | null | undefined, maxLength: number): string | null {
  const cleaned = value?.trim().slice(0, maxLength) ?? "";
  return cleaned || null;
}

function cleanedList(values: string[] | undefined, maxItems: number, maxLength: number): string[] {
  return (values ?? [])
    .map(value => value.trim().slice(0, maxLength))
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, maxItems);
}

function preferenceUpdates(body: typeof SavePreferencesBody._output) {
  return {
    displayName: cleanedText(body.displayName, 80),
    email: cleanedText(body.email?.toLowerCase(), 254),
    allergens: cleanedList(body.allergens, 20, 64),
    dietaryPreferences: cleanedList(body.dietaryPreferences, 20, 64),
    avoidIngredients: cleanedList(body.avoidIngredients, 30, 80),
    habits: cleanedList(body.habits, 20, 64),
    notes: cleanedText(body.notes, 500),
    householdMembers: (body.householdMembers ?? []).slice(0, 6).map(member => ({
      id: member.id.trim().slice(0, 64),
      name: member.name.trim().slice(0, 80),
      relationship: member.relationship,
      allergens: cleanedList(member.allergens, 20, 64),
      dietaryPreferences: cleanedList(member.dietaryPreferences, 20, 64),
      avoidIngredients: cleanedList(member.avoidIngredients, 30, 80),
      habits: cleanedList(member.habits, 20, 64),
      notes: cleanedText(member.notes, 500),
    })),
    personalizationEnabled: body.personalizationEnabled ?? false,
    locale: body.locale ?? "zh-TW",
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
  const email = body.data.email?.trim() ?? "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Invalid email format" });
    return;
  }

  const existing = await db.select().from(userPreferencesTable).where(eq(userPreferencesTable.sessionId, params.data.sessionId));
  const updates = preferenceUpdates(body.data);

  let result;
  if (existing.length > 0) {
    const [updated] = await db.update(userPreferencesTable).set({
      ...updates,
      updatedAt: new Date(),
    }).where(eq(userPreferencesTable.sessionId, params.data.sessionId)).returning();
    result = updated;
  } else {
    const [created] = await db.insert(userPreferencesTable).values({
      sessionId: params.data.sessionId,
      ...updates,
    }).returning();
    result = created;
  }

  res.json(prefToApi(result));
});

router.delete("/preferences/:sessionId", async (req, res): Promise<void> => {
  const params = SavePreferencesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  await db.delete(userPreferencesTable).where(eq(userPreferencesTable.sessionId, params.data.sessionId));
  res.status(204).send();
});

export default router;
