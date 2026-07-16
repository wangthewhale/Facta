import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productRetailerPricesTable = pgTable("product_retailer_prices", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  retailerId: integer("retailer_id").notNull(),
  priceNtd: numeric("price_ntd", { precision: 8, scale: 2 }),
  isAvailable: text("is_available").default("true"),
  sourceUrl: text("source_url"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductRetailerPriceSchema = createInsertSchema(productRetailerPricesTable).omit({ id: true, updatedAt: true });
export type InsertProductRetailerPrice = z.infer<typeof insertProductRetailerPriceSchema>;
export type ProductRetailerPrice = typeof productRetailerPricesTable.$inferSelect;
