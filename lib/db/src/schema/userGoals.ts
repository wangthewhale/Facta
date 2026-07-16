import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-session user goal selections and preferences.
 * Replaces / extends user_preferences with richer onboarding data.
 */
export const userGoalsTable = pgTable("user_goals", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  goalId: integer("goal_id").notNull(),
  // priority: primary | secondary
  priority: text("priority").notNull().default("primary"),
  // status: active | paused | completed
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Extended onboarding profile stored alongside user_preferences.
 */
export const userProfilesTable = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  // preferred_retailers: JSON array of retailer slugs
  preferredRetailers: jsonb("preferred_retailers").notNull().default([]),
  // budget: budget | standard | flexible
  budgetTier: text("budget_tier").default("standard"),
  // meal_timing: true means user wants meal-time recommendations
  wantsMealTiming: text("wants_meal_timing").default("true"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserGoalSchema = createInsertSchema(userGoalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserGoal = z.infer<typeof insertUserGoalSchema>;
export type UserGoal = typeof userGoalsTable.$inferSelect;

export const insertUserProfileSchema = createInsertSchema(userProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UserProfile = typeof userProfilesTable.$inferSelect;
