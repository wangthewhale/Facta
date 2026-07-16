import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productIngredientsTable = pgTable("product_ingredients", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  ingredientId: integer("ingredient_id"),
  rawName: text("raw_name").notNull(),
  position: integer("position"),
  sourceType: text("source_type").default("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductIngredientSchema = createInsertSchema(productIngredientsTable).omit({ id: true, createdAt: true });
export type InsertProductIngredient = z.infer<typeof insertProductIngredientSchema>;
export type ProductIngredient = typeof productIngredientsTable.$inferSelect;
