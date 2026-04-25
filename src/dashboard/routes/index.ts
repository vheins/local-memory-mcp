import { Router } from "express";
import systemRoutes from "./system.routes";
import memoryRoutes from "./memory.routes";
import taskRoutes from "./task.routes";
import standardRoutes from "./standard.routes";
import coordinationRoutes from "./coordination.routes";

const router = Router();

router.use("/", systemRoutes);
router.use("/memories", memoryRoutes);
router.use("/tasks", taskRoutes);
router.use("/standards", standardRoutes);
router.use("/coordination", coordinationRoutes);

export default router;
