import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Cached AI web-search results about a product's brand/company news.
 * Refreshed when stale (older than NEWS_TTL) to limit search billing.
 */
export const productNewsTable = pgTable("product_news", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().unique(),
  // sentiment: positive | negative | mixed | neutral | none
  sentiment: text("sentiment").notNull().default("none"),
  summary: text("summary"),
  summaryZh: text("summary_zh"),
  articles: jsonb("articles").notNull().default([]),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductNewsSchema = createInsertSchema(productNewsTable).omit({ id: true, createdAt: true });
export type InsertProductNews = z.infer<typeof insertProductNewsSchema>;
export type ProductNews = typeof productNewsTable.$inferSelect;
