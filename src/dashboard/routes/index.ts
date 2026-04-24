import { Router } from "express";
import systemRoutes from "./system.routes";
import memoryRoutes from "./memory.routes";
import taskRoutes from "./task.routes";
import standardRoutes from "./standard.routes";

const router = Router();

router.use("/", systemRoutes);
router.use("/memories", memoryRoutes);
router.use("/tasks", taskRoutes);
router.use("/standards", standardRoutes);

export default router;
