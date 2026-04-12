import { Router } from "express";
import { SystemController } from "../controllers/SystemController.js";

const router = Router();

router.get("/health", SystemController.getHealth);
router.get("/repos", SystemController.getRepos);
router.get("/stats", SystemController.getStats);
router.get("/recent-actions", SystemController.getRecentActions);
router.get("/capabilities", SystemController.getCapabilities);
router.get("/export", SystemController.getExport);
router.post("/tools/:name/call", SystemController.callTool);

export default router;
