import { Router } from "express";
import systemRoutes from "./system.routes.js";
import memoryRoutes from "./memory.routes.js";
import taskRoutes from "./task.routes.js";

const router = Router();

router.use("/", systemRoutes);
router.use("/memories", memoryRoutes);
router.use("/tasks", taskRoutes);

export default router;
