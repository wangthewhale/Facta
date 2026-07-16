import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productSubmissionsTable = pgTable("product_submissions", {
  id: serial("id").primaryKey(),
  productName: text("product_name").notNull(),
  brandName: text("brand_name"),
  barcode: text("barcode"),
  retailerSlug: text("retailer_slug"),
  // status: pending_ocr | ocr_complete | pending_review | approved | rejected
  status: text("status").notNull().default("pending_ocr"),
  ocrStatus: text("ocr_status"),
  extractedIngredients: text("extracted_ingredients"),
  extractedNutrition: jsonb("extracted_nutrition"),
  provisionalScore: integer("provisional_score"),
  provisionalGrade: text("provisional_grade"),
  dataCompleteness: text("data_completeness"),
  frontImageUrl: text("front_image_url"),
  ingredientsImageUrl: text("ingredients_image_url"),
  nutritionImageUrl: text("nutrition_image_url"),
  userSession: text("user_session"),
  userConsented: text("user_consented").default("false"),
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  resolvedProductId: integer("resolved_product_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductSubmissionSchema = createInsertSchema(productSubmissionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProductSubmission = z.infer<typeof insertProductSubmissionSchema>;
export type ProductSubmission = typeof productSubmissionsTable.$inferSelect;
