import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * My Day: user marks a scanned product as eaten for a specific meal.
 * First version: no calorie totaling — just pattern reflection.
 */
export const mealLogsTable = pgTable("meal_logs", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  productId: integer("product_id").notNull(),
  // meal_type: breakfast | lunch | dinner | snack
  mealType: text("meal_type").notNull(),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  // date_str: YYYY-MM-DD in local time — used for "today" grouping
  dateStr: text("date_str").notNull(),
  note: text("note"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertMealLogSchema = createInsertSchema(mealLogsTable).omit({ id: true, loggedAt: true });
export type InsertMealLog = z.infer<typeof insertMealLogSchema>;
export type MealLog = typeof mealLogsTable.$inferSelect;
