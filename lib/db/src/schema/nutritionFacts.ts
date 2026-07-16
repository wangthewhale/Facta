import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const nutritionFactsTable = pgTable("nutrition_facts", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().unique(),
  servingSize: text("serving_size"),
  servingSizeUnit: text("serving_size_unit"),
  calories: numeric("calories", { precision: 8, scale: 2 }),
  totalFat: numeric("total_fat", { precision: 8, scale: 2 }),
  saturatedFat: numeric("saturated_fat", { precision: 8, scale: 2 }),
  transFat: numeric("trans_fat", { precision: 8, scale: 2 }),
  sodium: numeric("sodium", { precision: 8, scale: 2 }),
  totalCarbs: numeric("total_carbs", { precision: 8, scale: 2 }),
  dietaryFiber: numeric("dietary_fiber", { precision: 8, scale: 2 }),
  totalSugars: numeric("total_sugars", { precision: 8, scale: 2 }),
  protein: numeric("protein", { precision: 8, scale: 2 }),
  sourceType: text("source_type").default("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNutritionFactSchema = createInsertSchema(nutritionFactsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNutritionFact = z.infer<typeof insertNutritionFactSchema>;
export type NutritionFact = typeof nutritionFactsTable.$inferSelect;
