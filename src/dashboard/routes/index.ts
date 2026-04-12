import { Router } from "express";
import systemRoutes from "./system.routes";
import memoryRoutes from "./memory.routes";
import taskRoutes from "./task.routes";

const router = Router();

router.use("/", systemRoutes);
router.use("/memories", memoryRoutes);
router.use("/tasks", taskRoutes);

export default router;
