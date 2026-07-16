import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dataCorrectionsTable = pgTable("data_corrections", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  // issue_type: wrong_ingredients | wrong_nutrition | wrong_barcode | wrong_image | outdated | other
  issueType: text("issue_type").notNull(),
  description: text("description"),
  // status: open | resolved | dismissed
  status: text("status").notNull().default("open"),
  userSession: text("user_session"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDataCorrectionSchema = createInsertSchema(dataCorrectionsTable).omit({ id: true, createdAt: true });
export type InsertDataCorrection = z.infer<typeof insertDataCorrectionSchema>;
export type DataCorrection = typeof dataCorrectionsTable.$inferSelect;
