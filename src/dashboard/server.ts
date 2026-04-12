#!/usr/bin/env node
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db, mcpClient, logger } from "./lib/context.js";
import routes from "./routes/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pkg = { version: "0.0.0" };
try {
  const pkgPath = path.join(__dirname, "../../package.json");
  if (fs.existsSync(pkgPath)) {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  }
} catch (e) {}

const app = express();
const PORT = process.env.PORT || 3456;

// --- Middleware ---
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn("Slow request", { method: req.method, path: req.path, duration });
    }
  });
  next();
});

// --- API Routes ---
app.use("/api", routes);

// --- Static Serving ---
const staticRoot = fs.existsSync(path.join(__dirname, "public")) 
  ? path.join(__dirname, "public") 
  : path.join(process.cwd(), "src", "dashboard", "public");

app.use(express.static(staticRoot));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(staticRoot, "index.html"));
});

// --- Start Server ---
if (process.env.DASHBOARD_ENABLE_MCP === "true") {
  mcpClient.start().catch(e => logger.error("MCP Client failed", { error: e.message }));
}

app.listen(PORT, () => {
  console.log(`${new Date().toISOString()} DASHBOARD_STARTING v${pkg.version} on port ${PORT}`);
});

process.on("SIGINT", () => { mcpClient.stop(); db.close(); process.exit(0); });
process.on("SIGTERM", () => { mcpClient.stop(); db.close(); process.exit(0); });
