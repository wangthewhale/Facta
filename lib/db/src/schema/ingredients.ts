import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ingredientsTable = pgTable("ingredients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  nameZh: text("name_zh"),
  // risk_level: safe | caution | avoid | unknown
  riskLevel: text("risk_level").default("unknown"),
  riskReason: text("risk_reason"),
  evidenceStrength: text("evidence_strength").default("low"),
  isAdditive: text("is_additive").default("false"),
  eNumber: text("e_number"),
  regulationRegion: text("regulation_region").default("TW"),
  sourceUrl: text("source_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIngredientSchema = createInsertSchema(ingredientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIngredient = z.infer<typeof insertIngredientSchema>;
export type Ingredient = typeof ingredientsTable.$inferSelect;
