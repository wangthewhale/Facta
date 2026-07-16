import { Router } from "express";
import healthRouter from "./health.js";
import productsRouter from "./products.js";
import evaluationsRouter from "./evaluations.js";
import alternativesRouter from "./alternatives.js";
import scanRouter from "./scan.js";
import submissionsRouter from "./submissions.js";
import preferencesRouter from "./preferences.js";
import referenceRouter from "./reference.js";
import adminRouter from "./admin.js";

const router = Router();

router.use(healthRouter);
router.use(productsRouter);
router.use(evaluationsRouter);
router.use(alternativesRouter);
router.use(scanRouter);
router.use(submissionsRouter);
router.use(preferencesRouter);
router.use(referenceRouter);
router.use(adminRouter);

export default router;
