import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const barcodesTable = pgTable("barcodes", {
  id: serial("id").primaryKey(),
  barcode: text("barcode").notNull().unique(),
  productId: integer("product_id").notNull(),
  barcodeType: text("barcode_type").default("EAN13"),
  isPrimary: text("is_primary").default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBarcodeSchema = createInsertSchema(barcodesTable).omit({ id: true, createdAt: true });
export type InsertBarcode = z.infer<typeof insertBarcodeSchema>;
export type Barcode = typeof barcodesTable.$inferSelect;
