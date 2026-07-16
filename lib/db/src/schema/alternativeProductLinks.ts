import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alternativeProductLinksTable = pgTable("alternative_product_links", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  alternativeProductId: integer("alternative_product_id").notNull(),
  retailerId: integer("retailer_id"),
  whyBetter: text("why_better").notNull(),
  whyBetterZh: text("why_better_zh"),
  scoreImprovement: integer("score_improvement"),
  priceDifferenceNtd: numeric("price_difference_ntd", { precision: 8, scale: 2 }),
  sameRetailer: text("same_retailer").default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAlternativeProductLinkSchema = createInsertSchema(alternativeProductLinksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAlternativeProductLink = z.infer<typeof insertAlternativeProductLinkSchema>;
export type AlternativeProductLink = typeof alternativeProductLinksTable.$inferSelect;
