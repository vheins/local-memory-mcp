import { Router } from "express";
import { CoordinationController } from "../controllers/CoordinationController";

const router = Router();

router.get("/claims", CoordinationController.listClaims);
router.post("/claims/release", CoordinationController.releaseClaim);

export default router;
