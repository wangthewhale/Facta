import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Curated product collections — e.g. "High-protein lunches at 全家".
 * Used for homepage recommendations and goal detail pages.
 */
export const curatedCollectionsTable = pgTable("curated_collections", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameZh: text("name_zh").notNull(),
  description: text("description"),
  descriptionZh: text("description_zh"),
  goalId: integer("goal_id"),
  retailerId: integer("retailer_id"),
  // meal_type: breakfast | lunch | dinner | snack | any
  mealType: text("meal_type").default("any"),
  // status: draft | published | archived
  status: text("status").notNull().default("draft"),
  sortOrder: integer("sort_order").default(0),
  tags: jsonb("tags").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collectionProductsTable = pgTable("collection_products", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").notNull(),
  productId: integer("product_id").notNull(),
  reasonZh: text("reason_zh"),
  reason: text("reason"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCuratedCollectionSchema = createInsertSchema(curatedCollectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCuratedCollection = z.infer<typeof insertCuratedCollectionSchema>;
export type CuratedCollection = typeof curatedCollectionsTable.$inferSelect;

export const insertCollectionProductSchema = createInsertSchema(collectionProductsTable).omit({ id: true, createdAt: true });
export type InsertCollectionProduct = z.infer<typeof insertCollectionProductSchema>;
export type CollectionProduct = typeof collectionProductsTable.$inferSelect;
