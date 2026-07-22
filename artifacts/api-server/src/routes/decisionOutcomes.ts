import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  decisionOutcomesTable,
  productEvaluationsTable,
  productsTable,
} from "@workspace/db";
import {
  CreateDecisionOutcomeBody,
  DeleteDecisionOutcomeParams,
  DeleteDecisionOutcomeQueryParams,
  ListDecisionOutcomesQueryParams,
} from "@workspace/api-zod";
import { resolveCatalogProduct } from "../lib/catalogEvidence.js";
import { validateDecisionCombination } from "../lib/decisionOutcomes.js";

const router: IRouter = Router();

async function decisionsToApi(
  rows: (typeof decisionOutcomesTable.$inferSelect)[],
) {
  const productIds = Array.from(
    new Set(
      rows.flatMap((row) => [
        row.productId,
        ...(row.selectedAlternativeProductId
          ? [row.selectedAlternativeProductId]
          : []),
      ]),
    ),
  );
  const products = productIds.length
    ? await db
        .select()
        .from(productsTable)
        .where(inArray(productsTable.id, productIds))
    : [];
  const productsById = new Map(
    products.map((product) => [product.id, product]),
  );

  return rows.map((row) => {
    const product = productsById.get(row.productId);
    const alternative = row.selectedAlternativeProductId
      ? productsById.get(row.selectedAlternativeProductId)
      : null;
    const presentation = product
      ? resolveCatalogProduct(product, null, null)
      : null;
    const alternativePresentation = alternative
      ? resolveCatalogProduct(alternative, null, null)
      : null;

    return {
      id: row.id,
      clientEventId: row.clientEventId,
      sessionId: row.sessionId,
      productId: row.productId,
      evaluationId: row.evaluationId,
      recommendationCode: row.recommendationCode,
      outcomeCode: row.outcomeCode,
      selectedAlternativeProductId: row.selectedAlternativeProductId,
      reasonCode: row.reasonCode,
      note: row.note,
      source: row.source,
      productName: presentation?.name ?? null,
      productNameZh: presentation?.nameZh ?? null,
      imageUrl: presentation?.imageUrl ?? null,
      selectedAlternativeName: alternativePresentation?.name ?? null,
      selectedAlternativeNameZh: alternativePresentation?.nameZh ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

router.get("/decision-outcomes", async (req, res): Promise<void> => {
  const parsed = ListDecisionOutcomesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db
    .select()
    .from(decisionOutcomesTable)
    .where(eq(decisionOutcomesTable.sessionId, parsed.data.session_id))
    .orderBy(desc(decisionOutcomesTable.createdAt))
    .limit(parsed.data.limit);

  res.json(await decisionsToApi(rows));
});

router.post("/decision-outcomes", async (req, res): Promise<void> => {
  const parsed = CreateDecisionOutcomeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const combinationError = validateDecisionCombination({
    productId: data.productId,
    recommendationCode: data.recommendationCode,
    outcomeCode: data.outcomeCode,
    selectedAlternativeProductId: data.selectedAlternativeProductId,
  });
  if (combinationError) {
    res.status(400).json({ error: combinationError });
    return;
  }

  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, data.productId))
    .limit(1);
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const [evaluation] = await db
    .select({
      id: productEvaluationsTable.id,
      productId: productEvaluationsTable.productId,
    })
    .from(productEvaluationsTable)
    .where(eq(productEvaluationsTable.id, data.evaluationId))
    .limit(1);
  if (!evaluation || evaluation.productId !== data.productId) {
    res.status(404).json({ error: "Evaluation not found for this product" });
    return;
  }

  if (data.selectedAlternativeProductId) {
    const [alternative] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.id, data.selectedAlternativeProductId))
      .limit(1);
    if (!alternative) {
      res.status(404).json({ error: "Alternative product not found" });
      return;
    }
  }

  const [existing] = await db
    .select()
    .from(decisionOutcomesTable)
    .where(eq(decisionOutcomesTable.clientEventId, data.clientEventId))
    .limit(1);
  if (existing) {
    const isSameDecision =
      existing.sessionId === data.sessionId &&
      existing.productId === data.productId &&
      existing.evaluationId === data.evaluationId &&
      existing.recommendationCode === data.recommendationCode &&
      existing.outcomeCode === data.outcomeCode &&
      existing.selectedAlternativeProductId ===
        (data.selectedAlternativeProductId ?? null);
    if (!isSameDecision) {
      res
        .status(409)
        .json({ error: "This decision event ID is already in use" });
      return;
    }
    const [response] = await decisionsToApi([existing]);
    res.status(201).json(response);
    return;
  }

  const [created] = await db
    .insert(decisionOutcomesTable)
    .values({
      clientEventId: data.clientEventId,
      sessionId: data.sessionId,
      productId: data.productId,
      evaluationId: data.evaluationId,
      recommendationCode: data.recommendationCode,
      outcomeCode: data.outcomeCode,
      selectedAlternativeProductId: data.selectedAlternativeProductId ?? null,
      reasonCode: data.reasonCode ?? null,
      note: data.note?.trim() || null,
      source: data.source,
    })
    .returning();

  const [response] = await decisionsToApi([created]);
  res.status(201).json(response);
});

router.delete("/decision-outcomes/:id", async (req, res): Promise<void> => {
  const params = DeleteDecisionOutcomeParams.safeParse(req.params);
  const query = DeleteDecisionOutcomeQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const [deleted] = await db
    .delete(decisionOutcomesTable)
    .where(
      and(
        eq(decisionOutcomesTable.id, params.data.id),
        eq(decisionOutcomesTable.sessionId, query.data.session_id),
      ),
    )
    .returning({ id: decisionOutcomesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Decision not found for this session" });
    return;
  }
  res.json({ ok: true });
});

export default router;
