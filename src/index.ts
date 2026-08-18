#!/usr/bin/env node
import express from "express";
import { Server } from "http";
import path from "path";
import { closeStore, initStore } from "./store";
import apiRouter from "./routes";
import { McpHttpServer, startMcpHttpServer } from "./mcp-server";

function parseArgs() {
  const args = process.argv.slice(2);
  let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3456;
  if (Number.isNaN(port)) port = 3456;
  const host = process.env.HOST || "0.0.0.0";
  let dataDir = path.resolve("data");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) port = parseInt(args[i + 1], 10);
    if (args[i] === "--data" && args[i + 1]) dataDir = path.resolve(args[i + 1]);
  }

  return { port, host, dataDir };
}

const { port, host, dataDir } = parseArgs();

const app = express();

app.use(express.json({ limit: "1mb" }));

// Dashboard static files
app.use(express.static(path.join(__dirname, "..", "dashboard")));

// Client view (read-only dashboard)
app.get("/dashboard/client/:projectId", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "dashboard", "client.html"));
});

// SPA fallback
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "dashboard", "index.html"));
});

(async () => {
  await initStore({ dataDir });
  const mcpEnabled = process.env.MCP_ENABLED !== "false";
  const mcpServer = mcpEnabled ? await startMcpHttpServer() : undefined;

  // API routes
  app.use("/api", apiRouter);

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[error]", err.stack || err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  const httpServer = app.listen(port, host, () => {
    console.log(`Agent Board running at http://${host}:${port}`);
    console.log(`Dashboard: http://localhost:${port}`);
    console.log(`API: http://localhost:${port}/api`);
    console.log(`Data dir: ${dataDir}`);
  });

  installShutdown(httpServer, mcpServer);
})();

function installShutdown(httpServer: Server, mcpServer?: McpHttpServer): void {
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.all([
      new Promise<void>((resolve, reject) => httpServer.close(err => err ? reject(err) : resolve())),
      mcpServer?.close() ?? Promise.resolve(),
    ]);
    await closeStore();
  };
  process.once("SIGTERM", () => { shutdown().catch(err => console.error("Shutdown error:", err)); });
  process.once("SIGINT", () => { shutdown().catch(err => console.error("Shutdown error:", err)); });
}
