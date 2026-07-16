import { pgTable, text, serial, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameZh: text("name_zh"),
  brandId: integer("brand_id"),
  categoryId: integer("category_id"),
  // verification_status: verified | provisional | incomplete | pending | demo
  verificationStatus: text("verification_status").notNull().default("pending"),
  dataCompleteness: numeric("data_completeness", { precision: 5, scale: 2 }),
  imageUrl: text("image_url"),
  netWeight: text("net_weight"),
  ingredientsList: text("ingredients_list"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
