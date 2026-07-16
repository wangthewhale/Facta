import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { productSubmissionsTable, productsTable, dataCorrectionsTable, auditLogsTable } from "@workspace/db";
import {
  AdminListPendingQueryParams, AdminVerifySubmissionParams, AdminVerifySubmissionBody,
  AdminRejectSubmissionParams, AdminRejectSubmissionBody,
  AdminUpdateProductParams, AdminUpdateProductBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function submissionToApi(s: typeof productSubmissionsTable.$inferSelect) {
  return {
    id: s.id,
    productName: s.productName,
    brandName: s.brandName,
    barcode: s.barcode,
    status: s.status,
    ocrStatus: s.ocrStatus,
    extractedIngredients: s.extractedIngredients,
    provisionalScore: s.provisionalScore,
    provisionalGrade: s.provisionalGrade,
    dataCompleteness: s.dataCompleteness ? parseFloat(s.dataCompleteness) : null,
    userSession: s.userSession,
    reviewNote: s.reviewNote,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

router.get("/admin/pending", async (req, res): Promise<void> => {
  const parsed = AdminListPendingQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 20) : 20;
  const offset = parsed.success ? (parsed.data.offset ?? 0) : 0;

  const rows = await db.select().from(productSubmissionsTable)
    .where(eq(productSubmissionsTable.status, "pending_review"))
    .orderBy(desc(productSubmissionsTable.createdAt))
    .limit(limit).offset(offset);

  res.json(rows.map(submissionToApi));
});

router.post("/admin/submissions/:id/verify", async (req, res): Promise<void> => {
  const params = AdminVerifySubmissionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = AdminVerifySubmissionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [updated] = await db.update(productSubmissionsTable).set({
    status: "approved",
    reviewedBy: body.data.reviewedBy,
    reviewNote: body.data.note ?? null,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(productSubmissionsTable.id, params.data.id)).returning();

  if (!updated) { res.status(404).json({ error: "Submission not found" }); return; }

  await db.insert(auditLogsTable).values({
    entityType: "product_submission",
    entityId: params.data.id,
    action: "verify",
    changedBy: body.data.reviewedBy,
    newValue: { status: "approved" },
  });

  res.json(submissionToApi(updated));
});

router.post("/admin/submissions/:id/reject", async (req, res): Promise<void> => {
  const params = AdminRejectSubmissionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = AdminRejectSubmissionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [updated] = await db.update(productSubmissionsTable).set({
    status: "rejected",
    reviewedBy: body.data.reviewedBy,
    reviewNote: body.data.note ?? null,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(productSubmissionsTable.id, params.data.id)).returning();

  if (!updated) { res.status(404).json({ error: "Submission not found" }); return; }

  await db.insert(auditLogsTable).values({
    entityType: "product_submission",
    entityId: params.data.id,
    action: "reject",
    changedBy: body.data.reviewedBy,
    newValue: { status: "rejected" },
  });

  res.json(submissionToApi(updated));
});

router.patch("/admin/products/:id", async (req, res): Promise<void> => {
  const params = AdminUpdateProductParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = AdminUpdateProductBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const updateData: Partial<typeof productsTable.$inferInsert> = {};
  if (body.data.name !== undefined) updateData.name = body.data.name;
  if (body.data.nameZh !== undefined) updateData.nameZh = body.data.nameZh;
  if (body.data.ingredientsList !== undefined) updateData.ingredientsList = body.data.ingredientsList;
  if (body.data.verificationStatus !== undefined) updateData.verificationStatus = body.data.verificationStatus;
  if (body.data.imageUrl !== undefined) updateData.imageUrl = body.data.imageUrl;
  if (body.data.netWeight !== undefined) updateData.netWeight = body.data.netWeight;
  updateData.updatedAt = new Date();

  const [updated] = await db.update(productsTable).set(updateData)
    .where(eq(productsTable.id, params.data.id)).returning();

  if (!updated) { res.status(404).json({ error: "Product not found" }); return; }

  await db.insert(auditLogsTable).values({
    entityType: "product",
    entityId: params.data.id,
    action: "admin_update",
    newValue: updateData,
  });

  res.json({
    id: updated.id,
    name: updated.name,
    nameZh: updated.nameZh,
    verificationStatus: updated.verificationStatus,
    imageUrl: updated.imageUrl,
    ingredientsList: updated.ingredientsList,
    brandName: null,
    barcode: null,
    categorySlug: null,
    categoryName: null,
    categoryNameZh: null,
    dataCompleteness: updated.dataCompleteness ? parseFloat(updated.dataCompleteness) : null,
    retailerName: null,
    retailerId: null,
    priceNtd: null,
    netWeight: updated.netWeight,
    ingredients: [],
    nutritionFacts: null,
    allergens: [],
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

router.get("/admin/corrections", async (_req, res): Promise<void> => {
  const rows = await db.select().from(dataCorrectionsTable).orderBy(desc(dataCorrectionsTable.createdAt));
  res.json(rows.map(r => ({
    id: r.id,
    productId: r.productId,
    issueType: r.issueType,
    description: r.description,
    status: r.status,
    userSession: r.userSession,
    createdAt: r.createdAt.toISOString(),
  })));
});

export default router;
