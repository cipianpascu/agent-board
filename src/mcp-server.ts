#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, Server } from "http";
import { AsyncLocalStorage } from "async_hooks";
import { z } from "zod";
import * as store from "./store";
import { generateId, now } from "./utils";
import { Task, TaskColumn } from "./types";
import { moveTask, claimTask, renewTaskLease, releaseTask } from "./services";
import { appendAuditLog } from "./audit";

const server = new McpServer({
  name: "agent-board",
  version: "0.1.0",
});

// Each Streamable HTTP request is handled in its own async context.  This
// keeps the X-API-Key identity bound to tool execution even when requests from
// different agents are processed concurrently.
const actorContext = new AsyncLocalStorage<string>();

function currentActor(): string {
  const actor = actorContext.getStore();
  if (actor) return actor;
  if (apiKeyMap) throw new Error("MCP mutation is missing authenticated actor context");
  return "mcp";
}

// --- Tools ---

server.tool(
  "board_list_projects",
  "List all projects with optional filters",
  { status: z.string().optional(), owner: z.string().optional() },
  async (args) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await store.getProjects(args), null, 2) }],
  })
);

server.tool(
  "board_get_project",
  "Get project details with its tasks",
  { id: z.string() },
  async ({ id }) => {
    const project = await store.getProject(id);
    if (!project) return { content: [{ type: "text" as const, text: "Project not found" }], isError: true };
    const tasks = await store.getTasks({ projectId: id });
    return { content: [{ type: "text" as const, text: JSON.stringify({ ...project, tasks }, null, 2) }] };
  }
);

server.tool(
  "board_create_project",
  "Create a new project",
  { name: z.string(), owner: z.string().optional(), description: z.string().optional() },
  async ({ name, owner, description }) => {
    const project = await store.createProject({
      id: generateId("proj"),
      name,
      status: "active",
      owner: owner || "unknown",
      description: description || "",
      createdAt: now(),
      updatedAt: now(),
    });
    appendAuditLog({
      timestamp: now(),
      agentId: currentActor(),
      action: "project.create",
      projectId: project.id,
      details: `[MCP] Created project "${project.name}"`,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }] };
  }
);

server.tool(
  "board_update_project",
  "Update project fields",
  { id: z.string(), name: z.string().optional(), status: z.enum(["active", "archived"]).optional(), owner: z.string().optional(), description: z.string().optional() },
  async ({ id, ...updates }) => {
    const project = await store.updateProject(id, updates);
    if (!project) return { content: [{ type: "text" as const, text: "Project not found" }], isError: true };
    appendAuditLog({
      timestamp: now(),
      agentId: currentActor(),
      action: "project.update",
      projectId: id,
      details: `[MCP] Updated project fields: ${Object.keys(updates).join(", ")}`,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }] };
  }
);

server.tool(
  "board_create_task",
  "Create a new task in a project",
  {
    projectId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    assignee: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    tags: z.array(z.string()).optional(),
    column: z.enum(["backlog", "todo", "doing", "review", "done", "failed"]).optional(),
  },
  async ({ projectId, title, description, assignee, priority, tags, column }) => {
    const col: TaskColumn = column || "backlog";
    const task: Task = {
      id: generateId("task"),
      projectId,
      title,
      description: description || "",
      status: col,
      column: col,
      assignee: assignee || "",
      createdBy: currentActor(),
      priority: priority || "medium",
      tags: tags || [],
      dependencies: [],
      subtasks: [],
      comments: [],
      createdAt: now(),
      updatedAt: now(),
    };
    const created = await store.createTask(task);
    appendAuditLog({
      timestamp: now(),
      agentId: currentActor(),
      action: "task.create",
      taskId: created.id,
      projectId: created.projectId,
      details: `[MCP] Created task "${created.title}"`,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(created, null, 2) }] };
  }
);

server.tool(
  "board_update_task",
  "Update task fields (status, assignee, priority, etc.)",
  {
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    assignee: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    tags: z.array(z.string()).optional(),
    column: z.enum(["backlog", "todo", "doing", "review", "done", "failed"]).optional(),
  },
  async ({ id, ...updates }) => {
    const task = await store.updateTask(id, updates);
    if (!task) return { content: [{ type: "text" as const, text: "Task not found" }], isError: true };
    appendAuditLog({
      timestamp: now(),
      agentId: currentActor(),
      action: "task.update",
      taskId: task.id,
      projectId: task.projectId,
      details: `[MCP] Updated task fields: ${Object.keys(updates).join(", ")}`,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
  }
);

server.tool(
  "board_move_task",
  "Move a task to a different column (backlog, todo, doing, review, done, failed). The authenticated agent identity enforces ownership of an active lease.",
  { id: z.string(), column: z.enum(["backlog", "todo", "doing", "review", "done", "failed"]) },
  async ({ id, column }) => {
    const actor = currentActor();
    const taskBefore = await store.getTask(id);
    const result = await moveTask(id, column, actor);
    if ("error" in result && !("task" in result)) {
      return { content: [{ type: "text" as const, text: result.error }], isError: true };
    }
    const moveResult = result as { task: Task; retried: boolean; chainedTask?: Task };
    appendAuditLog({
      timestamp: now(),
      agentId: actor,
      action: "task.move",
      taskId: moveResult.task.id,
      projectId: moveResult.task.projectId,
      from: taskBefore?.column,
      to: column,
      details: `[MCP] Moved task from ${taskBefore?.column} to ${column}`,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "board_claim_task",
  "Atomically claim an unclaimed todo task and move it to doing",
  { id: z.string(), durationMs: z.number().optional() },
  async ({ id, durationMs }) => {
    const actor = currentActor();
    const result = await claimTask(id, actor, durationMs);
    if ("error" in result) return { content: [{ type: "text" as const, text: result.error }], isError: true };
    appendAuditLog({
      timestamp: now(),
      agentId: actor,
      action: "task.claim",
      taskId: result.task.id,
      projectId: result.task.projectId,
      to: result.task.column,
      details: `[MCP] Task claimed by ${actor} until ${result.task.leaseUntil}`,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "board_renew_task_lease",
  "Renew the lease on a claimed task",
  { id: z.string(), durationMs: z.number().optional() },
  async ({ id, durationMs }) => {
    const result = await renewTaskLease(id, currentActor(), durationMs);
    if ("error" in result) return { content: [{ type: "text" as const, text: result.error }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "board_release_task",
  "Release a claimed task back to todo",
  { id: z.string() },
  async ({ id }) => {
    const actor = currentActor();
    const result = await releaseTask(id, actor);
    if ("error" in result) return { content: [{ type: "text" as const, text: result.error }], isError: true };
    appendAuditLog({
      timestamp: now(),
      agentId: actor,
      action: "task.release",
      taskId: result.task.id,
      projectId: result.task.projectId,
      to: result.task.column,
      details: `[MCP] Task released by ${actor}`,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "board_add_comment",
  "Add a comment to a task",
  { taskId: z.string(), text: z.string() },
  async ({ taskId, text }) => {
    const actor = currentActor();
    const task = await store.addComment(taskId, { author: actor, text });
    if (!task) return { content: [{ type: "text" as const, text: "Task not found" }], isError: true };
    appendAuditLog({
      timestamp: now(),
      agentId: actor,
      action: "comment.add",
      taskId: task.id,
      projectId: task.projectId,
      details: `[MCP] Comment by ${actor}: ${text.slice(0, 100)}`,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
  }
);

server.tool(
  "board_list_comments",
  "List all comments for a task",
  { taskId: z.string() },
  async ({ taskId }) => {
    const task = await store.getTask(taskId);
    if (!task) return { content: [{ type: "text" as const, text: "Task not found" }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(task.comments, null, 2) }] };
  }
);

server.tool(
  "board_get_task_thread",
  "Get task summary with all comments (for agent context)",
  { taskId: z.string() },
  async ({ taskId }) => {
    const task = await store.getTask(taskId);
    if (!task) return { content: [{ type: "text" as const, text: "Task not found" }], isError: true };
    const thread = {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.column,
      assignee: task.assignee,
      priority: task.priority,
      tags: task.tags,
      comments: task.comments,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(thread, null, 2) }] };
  }
);

server.tool(
  "board_list_tasks",
  "List tasks with optional filters",
  {
    projectId: z.string().optional(),
    assignee: z.string().optional(),
    status: z.string().optional(),
    tag: z.string().optional(),
  },
  async (args) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await store.getTasks(args), null, 2) }],
  })
);

server.tool(
  "board_my_tasks",
  "List tasks assigned to the authenticated agent",
  {},
  async () => ({
    content: [{ type: "text" as const, text: JSON.stringify(await store.getTasks({ assignee: currentActor() }), null, 2) }],
  })
);

server.tool(
  "board_delete_task",
  "Delete a task by ID",
  { id: z.string() },
  async ({ id }) => {
    const task = await store.getTask(id);
    const deleted = await store.deleteTask(id);
    if (!deleted) return { content: [{ type: "text" as const, text: "Task not found" }], isError: true };
    appendAuditLog({
      timestamp: now(),
      agentId: currentActor(),
      action: "task.delete",
      taskId: id,
      projectId: task?.projectId,
      details: `[MCP] Deleted task "${task?.title || id}"`,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, deletedId: id }) }] };
  }
);

server.tool(
  "board_delete_project",
  "Delete a project and all its tasks",
  { id: z.string() },
  async ({ id }) => {
    const project = await store.getProject(id);
    const deleted = await store.deleteProject(id);
    if (!deleted) return { content: [{ type: "text" as const, text: "Project not found" }], isError: true };
    appendAuditLog({
      timestamp: now(),
      agentId: currentActor(),
      action: "project.delete",
      projectId: id,
      details: `[MCP] Deleted project "${project?.name || id}"`,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, deletedId: id }) }] };
  }
);

// --- Auth ---

function loadApiKeyMap(): Map<string, string> | undefined {
  const raw = process.env.AGENTBOARD_API_KEYS;
  if (!raw) return undefined;
  const map = new Map<string, string>();
  for (const part of raw.split(",")) {
    const [key, agentId] = part.trim().split(":");
    if (key && agentId) map.set(key, agentId);
  }
  return map;
}

const apiKeyMap = loadApiKeyMap();

function authenticatedAgentId(req: IncomingMessage): string | undefined {
  if (!apiKeyMap) return "mcp";
  const header = req.headers["x-api-key"];
  const key = Array.isArray(header) ? header[0] : header;
  return key ? apiKeyMap.get(key) : undefined;
}

// --- Start ---

function parseArgs() {
  const args = process.argv.slice(2);
  const dataIdx = args.indexOf("--data");
  const dataDir = dataIdx !== -1 && args[dataIdx + 1] ? args[dataIdx + 1] : undefined;
  const useStdio = args.includes("--stdio") || process.env.MCP_TRANSPORT === "stdio";
  const port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3457;
  return { dataDir, useStdio, port };
}

export interface McpHttpServer {
  close(): Promise<void>;
}

export interface McpHttpServerOptions {
  port?: number;
  host?: string;
}

// Run MCP on a second listener in the main Agent Board process. It shares the
// already-initialized store, database pool, audit sink, and shutdown lifecycle.
export async function startMcpHttpServer(options: McpHttpServerOptions = {}): Promise<McpHttpServer> {
  const port = options.port ?? (process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3457);
  const host = options.host ?? process.env.MCP_HOST ?? process.env.HOST ?? "0.0.0.0";
  if (Number.isNaN(port)) throw new Error("MCP_PORT must be a valid port number");

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const httpServer = createServer((req, res) => {
    if (!req.url?.startsWith("/mcp")) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const actor = authenticatedAgentId(req);
    if (!actor) {
      res.statusCode = 401;
      res.end("Unauthorized");
      return;
    }

    actorContext.run(actor, () => {
      transport.handleRequest(req, res).catch((err) => {
        console.error("[mcp] handleRequest error:", err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Internal server error");
        }
      });
    });
  });

  await listen(httpServer, port, host);
  console.log(`[mcp] stateless Streamable HTTP server listening on http://${host}:${port}/mcp`);

  return {
    async close(): Promise<void> {
      await Promise.all([
        new Promise<void>((resolve, reject) => httpServer.close(err => err ? reject(err) : resolve())),
        transport.close(),
      ]);
    },
  };
}

function listen(httpServer: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      httpServer.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port, host);
  });
}

async function main() {
  const { dataDir, useStdio, port } = parseArgs();
  await store.initStore({ dataDir });

  if (useStdio) {
    if (apiKeyMap) {
      throw new Error("AGENTBOARD_API_KEYS requires MCP HTTP transport so callers can provide X-API-Key");
    }
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("[mcp] stdio transport connected");
    return;
  }

  const mcpServer = await startMcpHttpServer({ port });
  const shutdown = async () => { await mcpServer.close(); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
}
