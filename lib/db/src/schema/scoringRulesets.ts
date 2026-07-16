import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scoringRulesetsTable = pgTable("scoring_rulesets", {
  id: serial("id").primaryKey(),
  version: text("version").notNull().unique(),
  description: text("description"),
  rules: jsonb("rules").notNull().default({}),
  isActive: text("is_active").default("true"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScoringRulesetSchema = createInsertSchema(scoringRulesetsTable).omit({ id: true, createdAt: true });
export type InsertScoringRuleset = z.infer<typeof insertScoringRulesetSchema>;
export type ScoringRuleset = typeof scoringRulesetsTable.$inferSelect;
