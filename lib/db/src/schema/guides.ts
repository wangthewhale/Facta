import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * FACTA Guides — editorial, evidence-led articles linked to goals.
 */
export const guidesTable = pgTable("guides", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  titleZh: text("title_zh").notNull(),
  summary: text("summary"),
  summaryZh: text("summary_zh"),
  body: text("body"),
  bodyZh: text("body_zh"),
  // status: draft | review | published | archived
  status: text("status").notNull().default("draft"),
  goalId: integer("goal_id"),
  coverImageUrl: text("cover_image_url"),
  evidenceLastReviewedAt: timestamp("evidence_last_reviewed_at", { withTimezone: true }),
  reviewDueDate: timestamp("review_due_date", { withTimezone: true }),
  limitations: text("limitations"),
  limitationsZh: text("limitations_zh"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const guideSourcesTable = pgTable("guide_sources", {
  id: serial("id").primaryKey(),
  guideId: integer("guide_id").notNull(),
  citation: text("citation").notNull(),
  url: text("url"),
  publishedYear: integer("published_year"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGuideSchema = createInsertSchema(guidesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGuide = z.infer<typeof insertGuideSchema>;
export type Guide = typeof guidesTable.$inferSelect;

export const insertGuideSourceSchema = createInsertSchema(guideSourcesTable).omit({ id: true, createdAt: true });
export type InsertGuideSource = z.infer<typeof insertGuideSourceSchema>;
export type GuideSource = typeof guideSourcesTable.$inferSelect;
