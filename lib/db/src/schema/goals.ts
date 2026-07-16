import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Master list of goals FACTA supports.
 * slug is the stable identifier — never rename it.
 */
export const goalsTable = pgTable("goals", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameZh: text("name_zh").notNull(),
  description: text("description"),
  descriptionZh: text("description_zh"),
  // status: active | coming_soon | archived
  status: text("status").notNull().default("active"),
  icon: text("icon"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Versioned rule thresholds for each goal.
 * Bump version to invalidate cached goal_product_evaluations.
 */
export const goalRulesetsTable = pgTable("goal_rulesets", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull(),
  version: text("version").notNull(),
  description: text("description"),
  // status: draft | review | published | archived
  status: text("status").notNull().default("draft"),
  rules: jsonb("rules").notNull().default({}),
  evidenceSources: jsonb("evidence_sources").notNull().default([]),
  reviewDueDate: timestamp("review_due_date", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-meal-context guidance copy for each goal × meal combo.
 */
export const mealContextsTable = pgTable("meal_contexts", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull(),
  // meal: breakfast | lunch | dinner | snack
  meal: text("meal").notNull(),
  headline: text("headline").notNull(),
  headlineZh: text("headline_zh").notNull(),
  // choose_more / choose_less are JSON arrays of guidance strings
  chooseMore: jsonb("choose_more").notNull().default([]),
  chooseMoreZh: jsonb("choose_more_zh").notNull().default([]),
  chooseLess: jsonb("choose_less").notNull().default([]),
  chooseLessZh: jsonb("choose_less_zh").notNull().default([]),
  ctaText: text("cta_text"),
  ctaTextZh: text("cta_text_zh"),
  // status: draft | published | archived
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGoalSchema = createInsertSchema(goalsTable).omit({ id: true, createdAt: true });
export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type Goal = typeof goalsTable.$inferSelect;

export const insertGoalRulesetSchema = createInsertSchema(goalRulesetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGoalRuleset = z.infer<typeof insertGoalRulesetSchema>;
export type GoalRuleset = typeof goalRulesetsTable.$inferSelect;

export const insertMealContextSchema = createInsertSchema(mealContextsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMealContext = z.infer<typeof insertMealContextSchema>;
export type MealContext = typeof mealContextsTable.$inferSelect;
