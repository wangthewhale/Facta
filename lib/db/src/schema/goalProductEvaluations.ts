import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Cached goal fit results. Cache is invalidated when either
 * product_version or goal_ruleset_version changes.
 *
 * INVARIANT: overallScore in product_evaluations is NEVER modified here.
 * Only goal_fit and meal_fit are computed.
 */
export const goalProductEvaluationsTable = pgTable("goal_product_evaluations", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  goalId: integer("goal_id").notNull(),
  goalRulesetVersion: text("goal_ruleset_version").notNull(),
  productDataVersion: text("product_data_version").notNull().default("1"),
  // fit_level: great_fit | good_fit | mixed_fit | poor_fit | insufficient_data
  fitLevel: text("fit_level").notNull(),
  fitReasons: jsonb("fit_reasons").notNull().default([]),
  warnings: jsonb("warnings").notNull().default([]),
  // meal_fit per meal type
  breakfastFit: text("breakfast_fit"),
  lunchFit: text("lunch_fit"),
  dinnerFit: text("dinner_fit"),
  snackFit: text("snack_fit"),
  inputDataCompleteness: text("input_data_completeness"),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGoalProductEvaluationSchema = createInsertSchema(goalProductEvaluationsTable).omit({ id: true, createdAt: true });
export type InsertGoalProductEvaluation = z.infer<typeof insertGoalProductEvaluationSchema>;
export type GoalProductEvaluation = typeof goalProductEvaluationsTable.$inferSelect;
