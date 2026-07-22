import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * The durable decision loop behind a FACTA recommendation.
 *
 * Scores remain objective and live in product_evaluations. This table only
 * records what a household chose after seeing a recommendation so FACTA can
 * learn which actions and alternatives are useful in the real world.
 */
export const decisionOutcomesTable = pgTable(
  "decision_outcomes",
  {
    id: serial("id").primaryKey(),
    clientEventId: text("client_event_id").notNull(),
    sessionId: text("session_id").notNull(),
    productId: integer("product_id").notNull(),
    evaluationId: integer("evaluation_id").notNull(),
    recommendationCode: text("recommendation_code").notNull(),
    outcomeCode: text("outcome_code").notNull(),
    selectedAlternativeProductId: integer("selected_alternative_product_id"),
    reasonCode: text("reason_code"),
    note: text("note"),
    source: text("source").notNull().default("report"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("decision_outcomes_client_event_idx").on(table.clientEventId),
    index("decision_outcomes_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    index("decision_outcomes_product_idx").on(table.productId),
  ],
);

export const insertDecisionOutcomeSchema = createInsertSchema(
  decisionOutcomesTable,
).omit({ id: true, createdAt: true });

export type InsertDecisionOutcome = z.infer<typeof insertDecisionOutcomeSchema>;
export type DecisionOutcome = typeof decisionOutcomesTable.$inferSelect;
