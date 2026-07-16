import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productEvaluationsTable = pgTable("product_evaluations", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  rulesetVersion: text("ruleset_version").notNull().default("1.0.0"),
  overallScore: integer("overall_score").notNull(),
  nutritionScore: integer("nutrition_score"),
  additiveScore: integer("additive_score"),
  // grade: Excellent | Good | Consider | Poor
  scoreGrade: text("score_grade").notNull(),
  verdict: text("verdict").notNull(),
  verdictZh: text("verdict_zh"),
  verificationStatus: text("verification_status").notNull().default("provisional"),
  dataCompleteness: text("data_completeness"),
  evidenceConfidence: text("evidence_confidence").default("medium"),
  topReasons: jsonb("top_reasons").notNull().default([]),
  additiveFlags: jsonb("additive_flags").notNull().default([]),
  allergenAlerts: jsonb("allergen_alerts").notNull().default([]),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductEvaluationSchema = createInsertSchema(productEvaluationsTable).omit({ id: true, createdAt: true });
export type InsertProductEvaluation = z.infer<typeof insertProductEvaluationSchema>;
export type ProductEvaluation = typeof productEvaluationsTable.$inferSelect;
