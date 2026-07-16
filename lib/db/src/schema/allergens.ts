import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const allergensTable = pgTable("allergens", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  nameZh: text("name_zh"),
  // severity: critical | moderate | low
  severity: text("severity").notNull().default("moderate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productAllergensTable = pgTable("product_allergens", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  allergenId: integer("allergen_id").notNull(),
  // presence: contains | may_contain | free_from
  presence: text("presence").notNull().default("contains"),
  sourceType: text("source_type").default("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAllergenSchema = createInsertSchema(allergensTable).omit({ id: true, createdAt: true });
export type InsertAllergen = z.infer<typeof insertAllergenSchema>;
export type Allergen = typeof allergensTable.$inferSelect;

export const insertProductAllergenSchema = createInsertSchema(productAllergensTable).omit({ id: true, createdAt: true });
export type InsertProductAllergen = z.infer<typeof insertProductAllergenSchema>;
export type ProductAllergen = typeof productAllergensTable.$inferSelect;
