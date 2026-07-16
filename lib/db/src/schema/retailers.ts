import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const retailersTable = pgTable("retailers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  country: text("country").notNull().default("TW"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRetailerSchema = createInsertSchema(retailersTable).omit({ id: true, createdAt: true });
export type InsertRetailer = z.infer<typeof insertRetailerSchema>;
export type Retailer = typeof retailersTable.$inferSelect;
