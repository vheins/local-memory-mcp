import { Router } from "express";
import { QueueController } from "../controllers/QueueController";

const router = Router();

router.get("/status", QueueController.status);

export default router;
