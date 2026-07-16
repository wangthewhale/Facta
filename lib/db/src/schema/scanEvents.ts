import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scanEventsTable = pgTable("scan_events", {
  id: serial("id").primaryKey(),
  // event_type: scan_started | barcode_detected | known_product_found | unknown_product_started | report_viewed | share_card_created | etc.
  eventType: text("event_type").notNull(),
  barcode: text("barcode"),
  productId: integer("product_id"),
  userSession: text("user_session"),
  hasUpdate: text("has_update").default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScanEventSchema = createInsertSchema(scanEventsTable).omit({ id: true, createdAt: true });
export type InsertScanEvent = z.infer<typeof insertScanEventSchema>;
export type ScanEvent = typeof scanEventsTable.$inferSelect;
