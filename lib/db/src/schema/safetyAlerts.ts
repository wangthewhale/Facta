import { pgTable, serial, integer, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Government-published food safety incidents (e.g. TFDA recalls).
 * Each alert has affected businesses/keywords used to match scanned products.
 */
export const safetyAlertsTable = pgTable("safety_alerts", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  titleZh: text("title_zh").notNull(),
  summary: text("summary").notNull(),
  summaryZh: text("summary_zh").notNull(),
  contaminant: text("contaminant"),
  contaminantZh: text("contaminant_zh"),
  severity: text("severity").notNull().default("high"), // high | medium | low
  officialUrl: text("official_url"),
  sourceUrls: jsonb("source_urls").notNull().default([]),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Affected businesses/brands for an alert, with product keywords for matching. */
export const safetyAlertItemsTable = pgTable("safety_alert_items", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull().references(() => safetyAlertsTable.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  // Keywords matched (case-insensitive contains) against brand name and product name
  matchKeywords: jsonb("match_keywords").notNull().default([]),
  // Human-readable examples of affected products
  productExamples: jsonb("product_examples").notNull().default([]),
  role: text("role").notNull().default("downstream"), // upstream_oil | downstream
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSafetyAlertSchema = createInsertSchema(safetyAlertsTable).omit({ id: true, createdAt: true });
export type InsertSafetyAlert = z.infer<typeof insertSafetyAlertSchema>;
export type SafetyAlert = typeof safetyAlertsTable.$inferSelect;
export type SafetyAlertItem = typeof safetyAlertItemsTable.$inferSelect;
