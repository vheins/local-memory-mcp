import { Router } from "express";
import { CodebaseController } from "../controllers/codebase-controller";

const router = Router();

router.get("/architecture", CodebaseController.getArchitecture);
router.get("/symbols", CodebaseController.getFileSymbols);
router.get("/search", CodebaseController.searchSymbols);
router.get("/trace", CodebaseController.traceSymbol);
router.get("/index-status", CodebaseController.getIndexStatus);
router.post("/index", CodebaseController.startIndex);
router.post("/auto-index", CodebaseController.autoIndex);

export default router;
