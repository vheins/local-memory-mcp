#!/usr/bin/env node
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db, mcpClient, logger } from "./lib/context";
import { addLogSink, createFileSink } from "../mcp/utils/logger";
import routes from "./routes/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Register file log sink (same dir as DB)
addLogSink(createFileSink(path.dirname(db.getDbPath())));
const pkg = { version: "0.0.0" };
try {
	const pkgPath = path.join(__dirname, "../../package.json");
	if (fs.existsSync(pkgPath)) {
		const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
		if (data.version) pkg.version = data.version;
	}
} catch {
	// Intentionally empty: error handled elsewhere
}

const app = express();
const PORT = process.env.PORT || 3456;

// --- Middleware ---
app.use(express.json());

app.use((req, res, next) => {
	const start = Date.now();
	res.on("finish", () => {
		const duration = Date.now() - start;
		logger.info("[Dashboard] request", { method: req.method, path: req.path, status: res.statusCode, ms: duration });
		if (duration > 1000) {
			logger.warn("[Dashboard] slow request", { method: req.method, path: req.path, ms: duration });
		}
	});
	next();
});

// --- API Routes ---
app.use("/api", routes);

// --- Static Serving ---
function getStaticRoot() {
	const possibleRoots = [
		path.join(__dirname, "public"), // Production bundled path
		path.join(process.cwd(), "dist", "dashboard", "public"), // Root-relative dist path
		path.join(process.cwd(), "src", "dashboard", "public") // Source path (unbuilt)
	];

	for (const root of possibleRoots) {
		if (fs.existsSync(path.join(root, "index.html"))) {
			return root;
		}
	}

	// Fallback to production bundled path if no built UI found
	return possibleRoots[0];
}

const staticRoot = getStaticRoot();
logger.debug("Dashboard serving assets from", { staticRoot });
app.use(express.static(staticRoot, { fallthrough: true }));

app.use((req, res, next) => {
	if (req.path.startsWith("/api")) return next();

	const indexPath = path.join(staticRoot, "index.html");
	if (fs.existsSync(indexPath)) {
		res.sendFile(indexPath);
	} else {
		logger.warn("Dashboard index.html not found", { path: indexPath });
		res.status(404).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard Not Built - Local Memory MCP</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 40px auto; padding: 20px; text-align: center; }
          h1 { color: #e53e3e; }
          code { background: #f7fafc; padding: 2px 4px; border-radius: 4px; border: 1px solid #edf2f7; font-family: monospace; }
          .container { border: 1px solid #e2e8f0; border-radius: 8px; padding: 30px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          .footer { margin-top: 30px; font-size: 0.8rem; color: #718096; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Dashboard Assets Not Found</h1>
          <p>The dashboard frontend has not been built yet or assets are missing at:</p>
          <code>${indexPath}</code>
          <p style="margin-top: 20px;">To fix this, please run the build command in the repository root:</p>
          <code>npm run build</code>
        </div>
        <div class="footer">Local Memory MCP v${pkg.version}</div>
      </body>
      </html>
    `);
	}
});

// --- Error Handler ---
app.use((err: Error & { status?: number }, req: express.Request, res: express.Response, next: express.NextFunction) => {
	if ((err as { status?: number }).status === 404) return res.status(404).end();
	logger.error("Unhandled error", { error: err.message });
	res.status(500).end();
	next();
});

// --- Start Server ---
if (process.env.DASHBOARD_ENABLE_MCP === "true") {
	mcpClient.start().catch((e) => logger.error("MCP Client failed", { error: e.message }));
}

function startServer() {
	const server = app.listen(PORT, () => {
		console.log(`${new Date().toISOString()} DASHBOARD_STARTING v${pkg.version} on port ${PORT}`);
	});

	server.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			console.log(`${new Date().toISOString()} DASHBOARD_ALREADY_RUNNING Dashboard already running on port ${PORT}. Exiting.`);
			process.exit(0);
		}
		throw err;
	});
}

startServer();

process.on("SIGINT", () => {
	mcpClient.stop();
	db.close();
	process.exit(0);
});
process.on("SIGTERM", () => {
	mcpClient.stop();
	db.close();
	process.exit(0);
});
