import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { chatRouter } from "./routes/chat.js";
import { projectsRouter } from "./routes/projects.js";
import { searchRouter } from "./routes/search.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// API Routes
app.route("/api/chat", chatRouter);
app.route("/api/projects", projectsRouter);
app.route("/api/search", searchRouter);

// Health check
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve static files (UI)
app.use("/", serveStatic({ root: "./src/web" }));
app.get("/", serveStatic({ path: "./src/web/index.html" }));

// Start server
const port = parseInt(process.env.PORT || "3000");

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🏛️  Public Sector Intelligence API                      ║
║                                                           ║
║   Server running at http://localhost:${port}                 ║
║                                                           ║
║   Endpoints:                                              ║
║   • POST /api/chat         - Chat with RAG                ║
║   • GET  /api/projects     - List all projects            ║
║   • GET  /api/projects/pipeline - Pipeline view           ║
║   • GET  /api/projects/:id - Project details              ║
║   • GET  /api/search       - Search documents/projects    ║
║   • GET  /api/search/entities - List entities             ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
});
