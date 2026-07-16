import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  goalsTable, goalRulesetsTable, mealContextsTable, guidesTable,
  userGoalsTable, userProfilesTable,
  goalProductEvaluationsTable, nutritionFactsTable, productsTable,
  auditLogsTable,
} from "@workspace/db";
import {
  GetGoalParams, ListGoalsQueryParams,
  GetUserGoalsParams, SetUserGoalsParams, SetUserGoalsBody,
  GetUserProfileParams, SaveUserProfileParams, SaveUserProfileBody,
  GetGoalFitParams,
  AdminCreateGoalBody, AdminUpdateGoalParams, AdminUpdateGoalBody,
  AdminPublishGoalRulesetBody,
  AdminUpdateMealContextParams, AdminUpdateMealContextBody,
} from "@workspace/api-zod";
import { calculateGoalFit, GOAL_RULESET_VERSION } from "../lib/goalFit.js";

const router: IRouter = Router();

// ─── Goals ────────────────────────────────────────────────────────────────────

router.get("/goals", async (req, res): Promise<void> => {
  const parsed = ListGoalsQueryParams.safeParse(req.query);
  const status = parsed.success ? parsed.data.status : undefined;

  const rows = await db.select().from(goalsTable)
    .where(status ? eq(goalsTable.status, status) : undefined)
    .orderBy(asc(goalsTable.sortOrder));

  res.json(rows.map(g => ({
    id: g.id, slug: g.slug, name: g.name, nameZh: g.nameZh,
    description: g.description, descriptionZh: g.descriptionZh,
    status: g.status, icon: g.icon, sortOrder: g.sortOrder,
  })));
});

router.get("/goals/:slug", async (req, res): Promise<void> => {
  const params = GetGoalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.slug, params.data.slug));
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }

  const mealContexts = await db.select().from(mealContextsTable)
    .where(eq(mealContextsTable.goalId, goal.id))
    .orderBy(asc(mealContextsTable.meal));

  const guides = await db.select().from(guidesTable)
    .where(eq(guidesTable.goalId, goal.id))
    .then(rows => rows.filter(g => g.status === "published"));

  res.json({
    id: goal.id, slug: goal.slug, name: goal.name, nameZh: goal.nameZh,
    description: goal.description, descriptionZh: goal.descriptionZh,
    status: goal.status, icon: goal.icon, sortOrder: goal.sortOrder,
    mealContexts: mealContexts.map(mc => ({
      id: mc.id, meal: mc.meal,
      headline: mc.headline, headlineZh: mc.headlineZh,
      chooseMore: mc.chooseMore, chooseMoreZh: mc.chooseMoreZh,
      chooseLess: mc.chooseLess, chooseLessZh: mc.chooseLessZh,
      ctaText: mc.ctaText, ctaTextZh: mc.ctaTextZh,
    })),
    guides: guides.map(g => ({
      id: g.id, slug: g.slug, title: g.title, titleZh: g.titleZh,
      summary: g.summary, summaryZh: g.summaryZh,
      goalId: g.goalId, coverImageUrl: g.coverImageUrl, status: g.status,
      publishedAt: g.publishedAt?.toISOString() ?? null,
    })),
  });
});

// ─── User Goals ───────────────────────────────────────────────────────────────

router.get("/user-goals/:sessionId", async (req, res): Promise<void> => {
  const params = GetUserGoalsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const { sessionId } = params.data;
  const userGoals = await db.select().from(userGoalsTable)
    .where(eq(userGoalsTable.sessionId, sessionId));

  const [profile] = await db.select().from(userProfilesTable)
    .where(eq(userProfilesTable.sessionId, sessionId));

  const activeGoals = await Promise.all(
    userGoals.filter(ug => ug.status === "active").map(async ug => {
      const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.id, ug.goalId));
      return {
        goalId: ug.goalId,
        goalSlug: goal?.slug ?? "",
        goalName: goal?.name ?? "",
        goalNameZh: goal?.nameZh ?? "",
        priority: ug.priority,
        status: ug.status,
      };
    })
  );

  res.json({
    sessionId,
    activeGoals,
    profile: profile ? profileToApi(profile) : null,
    onboardingCompleted: !!profile?.onboardingCompletedAt,
  });
});

router.put("/user-goals/:sessionId", async (req, res): Promise<void> => {
  const params = SetUserGoalsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = SetUserGoalsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { sessionId } = params.data;

  // Max 2 goals — enforced here
  const goalsToSet = body.data.goals.slice(0, 2);

  // Deactivate existing, then upsert new
  await db.update(userGoalsTable).set({ status: "paused", updatedAt: new Date() })
    .where(eq(userGoalsTable.sessionId, sessionId));

  for (const g of goalsToSet) {
    const existing = await db.select().from(userGoalsTable)
      .where(eq(userGoalsTable.sessionId, sessionId))
      .then(rows => rows.find(r => r.goalId === g.goalId));

    if (existing) {
      await db.update(userGoalsTable).set({ priority: g.priority, status: "active", updatedAt: new Date() })
        .where(eq(userGoalsTable.id, existing.id));
    } else {
      await db.insert(userGoalsTable).values({
        sessionId, goalId: g.goalId, priority: g.priority, status: "active",
      });
    }
  }

  // Return updated state — reuse GET logic
  const updated = await db.select().from(userGoalsTable)
    .where(eq(userGoalsTable.sessionId, sessionId));
  const [profile] = await db.select().from(userProfilesTable)
    .where(eq(userProfilesTable.sessionId, sessionId));

  const activeGoals = await Promise.all(
    updated.filter(ug => ug.status === "active").map(async ug => {
      const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.id, ug.goalId));
      return {
        goalId: ug.goalId,
        goalSlug: goal?.slug ?? "",
        goalName: goal?.name ?? "",
        goalNameZh: goal?.nameZh ?? "",
        priority: ug.priority,
        status: ug.status,
      };
    })
  );

  res.json({
    sessionId,
    activeGoals,
    profile: profile ? profileToApi(profile) : null,
    onboardingCompleted: !!profile?.onboardingCompletedAt,
  });
});

// ─── User Profile ─────────────────────────────────────────────────────────────

function profileToApi(p: typeof userProfilesTable.$inferSelect) {
  return {
    sessionId: p.sessionId,
    preferredRetailers: (p.preferredRetailers as string[]) ?? [],
    budgetTier: p.budgetTier,
    wantsMealTiming: p.wantsMealTiming === "true",
    onboardingCompleted: !!p.onboardingCompletedAt,
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.get("/profile/:sessionId", async (req, res): Promise<void> => {
  const params = GetUserProfileParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [profile] = await db.select().from(userProfilesTable)
    .where(eq(userProfilesTable.sessionId, params.data.sessionId));
  if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }

  res.json(profileToApi(profile));
});

router.put("/profile/:sessionId", async (req, res): Promise<void> => {
  const params = SaveUserProfileParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = SaveUserProfileBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { sessionId } = params.data;
  const existing = await db.select().from(userProfilesTable)
    .where(eq(userProfilesTable.sessionId, sessionId));

  const updates: Partial<typeof userProfilesTable.$inferInsert> = {
    preferredRetailers: body.data.preferredRetailers ?? [],
    budgetTier: body.data.budgetTier ?? "standard",
    wantsMealTiming: body.data.wantsMealTiming === false ? "false" : "true",
    updatedAt: new Date(),
  };

  if (body.data.onboardingCompletedAt) {
    updates.onboardingCompletedAt = new Date(body.data.onboardingCompletedAt);
  }

  let result;
  if (existing.length > 0) {
    const [updated] = await db.update(userProfilesTable).set(updates)
      .where(eq(userProfilesTable.sessionId, sessionId)).returning();
    result = updated;
  } else {
    const [created] = await db.insert(userProfilesTable).values({
      sessionId, ...updates,
    }).returning();
    result = created;
  }

  res.json(profileToApi(result));
});

// ─── Goal Fit ─────────────────────────────────────────────────────────────────

router.get("/goal-fit/:productId/:goalSlug", async (req, res): Promise<void> => {
  const params = GetGoalFitParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const { productId, goalSlug } = params.data;

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.slug, goalSlug));
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }

  // Check cached result
  const cached = await db.select().from(goalProductEvaluationsTable)
    .where(eq(goalProductEvaluationsTable.productId, productId))
    .then(rows => rows.find(r => r.goalId === goal.id && r.goalRulesetVersion === GOAL_RULESET_VERSION));

  if (cached) {
    res.json(formatGoalFit(cached, productId, goalSlug, goal));
    return;
  }

  // Compute fresh
  const [nutrition] = await db.select().from(nutritionFactsTable)
    .where(eq(nutritionFactsTable.productId, productId));

  const result = calculateGoalFit(goalSlug, {
    protein: nutrition?.protein ? parseFloat(nutrition.protein) : null,
    dietaryFiber: nutrition?.dietaryFiber ? parseFloat(nutrition.dietaryFiber) : null,
    totalSugars: nutrition?.totalSugars ? parseFloat(nutrition.totalSugars) : null,
    sodium: nutrition?.sodium ? parseFloat(nutrition.sodium) : null,
    calories: nutrition?.calories ? parseFloat(nutrition.calories) : null,
    saturatedFat: nutrition?.saturatedFat ? parseFloat(nutrition.saturatedFat) : null,
    transFat: nutrition?.transFat ? parseFloat(nutrition.transFat) : null,
  });

  const completeness = nutrition ? 0.8 : 0.2;

  const [saved] = await db.insert(goalProductEvaluationsTable).values({
    productId,
    goalId: goal.id,
    goalRulesetVersion: result.goalRulesetVersion,
    productDataVersion: "1",
    fitLevel: result.fitLevel,
    fitReasons: result.fitReasons,
    warnings: result.warnings,
    breakfastFit: result.breakfastFit,
    lunchFit: result.lunchFit,
    dinnerFit: result.dinnerFit,
    snackFit: result.snackFit,
    inputDataCompleteness: String(completeness),
  }).returning();

  res.json(formatGoalFit(saved, productId, goalSlug, goal));
});

function formatGoalFit(
  row: typeof goalProductEvaluationsTable.$inferSelect,
  productId: number,
  goalSlug: string,
  goal: typeof goalsTable.$inferSelect,
) {
  return {
    productId,
    goalSlug,
    goalName: goal.name,
    goalNameZh: goal.nameZh,
    fitLevel: row.fitLevel,
    fitReasons: (row.fitReasons as any[]) ?? [],
    warnings: (row.warnings as any[]) ?? [],
    breakfastFit: row.breakfastFit ?? "insufficient_data",
    lunchFit: row.lunchFit ?? "insufficient_data",
    dinnerFit: row.dinnerFit ?? "insufficient_data",
    snackFit: row.snackFit ?? "insufficient_data",
    inputDataCompleteness: row.inputDataCompleteness ? parseFloat(row.inputDataCompleteness) : null,
    goalRulesetVersion: row.goalRulesetVersion,
    evaluatedAt: row.evaluatedAt.toISOString(),
  };
}

// ─── Admin: Goals ─────────────────────────────────────────────────────────────

router.post("/admin/goals", async (req, res): Promise<void> => {
  const body = AdminCreateGoalBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [goal] = await db.insert(goalsTable).values({
    slug: body.data.slug ?? "",
    name: body.data.name ?? "",
    nameZh: body.data.nameZh ?? "",
    description: body.data.description ?? null,
    descriptionZh: body.data.descriptionZh ?? null,
    status: body.data.status ?? "draft",
    icon: body.data.icon ?? null,
    sortOrder: body.data.sortOrder ?? 0,
  }).returning();

  await db.insert(auditLogsTable).values({ entityType: "goal", entityId: goal.id, action: "create", newValue: goal });
  res.status(201).json({ id: goal.id, slug: goal.slug, name: goal.name, nameZh: goal.nameZh, status: goal.status });
});

router.patch("/admin/goals/:id", async (req, res): Promise<void> => {
  const params = AdminUpdateGoalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = AdminUpdateGoalBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const updates: Partial<typeof goalsTable.$inferInsert> = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if (body.data.nameZh !== undefined) updates.nameZh = body.data.nameZh;
  if (body.data.descriptionZh !== undefined) updates.descriptionZh = body.data.descriptionZh;
  if (body.data.status !== undefined) updates.status = body.data.status;
  if (body.data.icon !== undefined) updates.icon = body.data.icon;
  if (body.data.sortOrder !== undefined) updates.sortOrder = body.data.sortOrder;

  const [updated] = await db.update(goalsTable).set(updates).where(eq(goalsTable.id, params.data.id)).returning();
  if (!updated) { res.status(404).json({ error: "Goal not found" }); return; }

  await db.insert(auditLogsTable).values({ entityType: "goal", entityId: updated.id, action: "update", newValue: updates });
  res.json({ id: updated.id, slug: updated.slug, name: updated.name, nameZh: updated.nameZh, status: updated.status });
});

router.post("/admin/goal-rulesets", async (req, res): Promise<void> => {
  const body = AdminPublishGoalRulesetBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [rs] = await db.insert(goalRulesetsTable).values({
    goalId: body.data.goalId,
    version: body.data.version,
    description: body.data.description ?? null,
    rules: body.data.rules ?? {},
    status: body.data.status ?? "draft",
  }).returning();

  await db.insert(auditLogsTable).values({ entityType: "goal_ruleset", entityId: rs.id, action: "create", newValue: rs });
  res.status(201).json({ id: rs.id, goalId: rs.goalId, version: rs.version, status: rs.status });
});

router.patch("/admin/meal-contexts/:id", async (req, res): Promise<void> => {
  const params = AdminUpdateMealContextParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = AdminUpdateMealContextBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const updates: Partial<typeof mealContextsTable.$inferInsert> = { updatedAt: new Date() };
  if (body.data.headlineZh !== undefined) updates.headlineZh = body.data.headlineZh;
  if (body.data.chooseMoreZh !== undefined) updates.chooseMoreZh = body.data.chooseMoreZh;
  if (body.data.chooseLessZh !== undefined) updates.chooseLessZh = body.data.chooseLessZh;
  if (body.data.ctaTextZh !== undefined) updates.ctaTextZh = body.data.ctaTextZh;
  if (body.data.status !== undefined) updates.status = body.data.status;

  const [updated] = await db.update(mealContextsTable).set(updates).where(eq(mealContextsTable.id, params.data.id)).returning();
  if (!updated) { res.status(404).json({ error: "Meal context not found" }); return; }

  await db.insert(auditLogsTable).values({ entityType: "meal_context", entityId: updated.id, action: "update", newValue: updates });
  res.json({ id: updated.id, status: updated.status });
});

export default router;
