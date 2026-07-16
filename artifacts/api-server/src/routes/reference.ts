import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { retailersTable, categoriesTable, scanEventsTable, productsTable, productSubmissionsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/retailers", async (_req, res): Promise<void> => {
  const rows = await db.select().from(retailersTable);
  res.json(rows.map(r => ({ id: r.id, name: r.name, slug: r.slug, logoUrl: r.logoUrl })));
});

router.get("/categories", async (_req, res): Promise<void> => {
  const rows = await db.select().from(categoriesTable);
  res.json(rows.map(c => ({ id: c.id, name: c.name, slug: c.slug, nameZh: c.nameZh })));
});

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const allProducts = await db.select().from(productsTable);
  const verifiedProducts = allProducts.filter(p => p.verificationStatus === "verified");
  const totalScans = await db.select().from(scanEventsTable);
  const pendingReviews = await db.select().from(productSubmissionsTable).where(eq(productSubmissionsTable.status, "pending_review"));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const scansToday = totalScans.filter(s => s.createdAt >= today).length;

  res.json({
    totalProducts: allProducts.length,
    verifiedProducts: verifiedProducts.length,
    totalScans: totalScans.length,
    pendingReviews: pendingReviews.length,
    scansToday,
  });
});

export default router;
