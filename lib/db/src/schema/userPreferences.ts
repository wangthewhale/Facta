import { pgTable, serial, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userPreferencesTable = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  displayName: text("display_name"),
  email: text("email"),
  allergens: jsonb("allergens").notNull().default([]),
  dietaryPreferences: jsonb("dietary_preferences").notNull().default([]),
  avoidIngredients: jsonb("avoid_ingredients").notNull().default([]),
  habits: jsonb("habits").notNull().default([]),
  notes: text("notes"),
  householdMembers: jsonb("household_members").notNull().default([]),
  personalizationEnabled: boolean("personalization_enabled").notNull().default(false),
  locale: text("locale").default("zh-TW"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserPreferenceSchema = createInsertSchema(userPreferencesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserPreference = z.infer<typeof insertUserPreferenceSchema>;
export type UserPreference = typeof userPreferencesTable.$inferSelect;
