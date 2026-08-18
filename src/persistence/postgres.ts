import { Pool } from "pg";
import { Project, Task, Agent, Comment, NextTask } from "../types";
import { ProjectFilters, TaskFilters, Store } from "./types";

export interface ProjectRow {
  id: string;
  name: string;
  status: string;
  owner: string;
  description: string;
  client_view_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  column_id: string;
  assignee: string;
  created_by: string;
  priority: string;
  tags: string;
  dependencies: string;
  subtasks: string;
  comments: string;
  next_task: string | null;
  parent_task_id: string | null;
  deadline: string | null;
  input_path: string | null;
  output_path: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  retry_count: number;
  max_retries: number;
  requires_review: boolean;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRow {
  id: string;
  name: string;
  role: string;
  status: string;
  capabilities: string;
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? []);
}

function fromJson<T>(value: string | null): T {
  if (!value) return [] as unknown as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return [] as unknown as T;
  }
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    status: row.status as Project["status"],
    owner: row.owner,
    description: row.description,
    clientViewEnabled: row.client_view_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTask(row: TaskRow): Task {
  const comments = fromJson<Comment[]>(row.comments);
  const tags = fromJson<string[]>(row.tags);
  const dependencies = fromJson<string[]>(row.dependencies);
  const subtasks = fromJson<string[]>(row.subtasks);
  const nextTask = row.next_task ? (JSON.parse(row.next_task) as NextTask) : undefined;

  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status as Task["status"],
    column: row.column_id as Task["column"],
    assignee: row.assignee,
    createdBy: row.created_by,
    priority: row.priority as Task["priority"],
    tags,
    dependencies,
    subtasks,
    comments,
    nextTask,
    parentTaskId: row.parent_task_id ?? undefined,
    deadline: row.deadline ?? undefined,
    inputPath: row.input_path ?? undefined,
    outputPath: row.output_path ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    failedAt: row.failed_at ?? undefined,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    requiresReview: row.requires_review,
    durationMs: row.duration_ms ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status as Agent["status"],
    capabilities: fromJson<string[]>(row.capabilities),
  };
}

export async function migratePostgres(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      status              TEXT NOT NULL,
      owner               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      client_view_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL,
      column_id       TEXT NOT NULL,
      assignee        TEXT NOT NULL DEFAULT '',
      created_by      TEXT NOT NULL,
      priority        TEXT NOT NULL,
      tags            TEXT NOT NULL DEFAULT '[]',
      dependencies    TEXT NOT NULL DEFAULT '[]',
      subtasks        TEXT NOT NULL DEFAULT '[]',
      comments        TEXT NOT NULL DEFAULT '[]',
      next_task       TEXT,
      parent_task_id  TEXT,
      deadline        TEXT,
      input_path      TEXT,
      output_path     TEXT,
      started_at      TEXT,
      completed_at    TEXT,
      failed_at       TEXT,
      retry_count     INTEGER NOT NULL DEFAULT 0,
      max_retries     INTEGER NOT NULL DEFAULT 2,
      requires_review BOOLEAN NOT NULL DEFAULT FALSE,
      duration_ms     INTEGER,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL,
      capabilities  TEXT NOT NULL DEFAULT '[]'
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_column_id ON tasks(column_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id          SERIAL PRIMARY KEY,
      timestamp   TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      action      TEXT NOT NULL,
      task_id     TEXT,
      project_id  TEXT,
      from_col    TEXT,
      to_col      TEXT,
      details     TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_task_id ON audit_events(task_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_agent_id ON audit_events(agent_id)`);
}

export class PostgresStore implements Store {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async ready(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  // Projects

  async getProjects(filters?: ProjectFilters): Promise<Project[]> {
    const { rows } = await this.pool.query<ProjectRow>("SELECT * FROM projects");
    let projects = rows.map(rowToProject);
    if (filters?.status) projects = projects.filter(p => p.status === filters.status);
    if (filters?.owner) projects = projects.filter(p => p.owner === filters.owner);
    return projects;
  }

  async getProject(id: string): Promise<Project | undefined> {
    const { rows } = await this.pool.query<ProjectRow>("SELECT * FROM projects WHERE id = $1", [id]);
    return rows[0] ? rowToProject(rows[0]) : undefined;
  }

  async createProject(project: Project): Promise<Project> {
    await this.pool.query(
      `INSERT INTO projects (id, name, status, owner, description, client_view_enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        project.id,
        project.name,
        project.status,
        project.owner,
        project.description,
        !!project.clientViewEnabled,
        project.createdAt,
        project.updatedAt,
      ]
    );
    return project;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<ProjectRow>("SELECT * FROM projects WHERE id = $1 FOR UPDATE", [id]);
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const existing = rowToProject(rows[0]);
      const merged: Project = { ...existing, ...updates, updatedAt: new Date().toISOString() };
      await client.query(
        `UPDATE projects
         SET name = $1,
             status = $2,
             owner = $3,
             description = $4,
             client_view_enabled = $5,
             updated_at = $6
         WHERE id = $7`,
        [merged.name, merged.status, merged.owner, merged.description, !!merged.clientViewEnabled, merged.updatedAt, id]
      );
      await client.query("COMMIT");
      return merged;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteProject(id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM projects WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  // Tasks

  async getTasks(filters?: TaskFilters): Promise<Task[]> {
    const { rows } = await this.pool.query<TaskRow>("SELECT * FROM tasks");
    let tasks = rows.map(rowToTask);
    if (filters?.projectId) tasks = tasks.filter(t => t.projectId === filters.projectId);
    if (filters?.assignee) tasks = tasks.filter(t => t.assignee === filters.assignee);
    if (filters?.status) tasks = tasks.filter(t => t.status === filters.status || t.column === filters.status);
    if (filters?.tag) tasks = tasks.filter(t => t.tags.includes(filters.tag!));
    return tasks;
  }

  async getTask(id: string): Promise<Task | undefined> {
    const { rows } = await this.pool.query<TaskRow>("SELECT * FROM tasks WHERE id = $1", [id]);
    return rows[0] ? rowToTask(rows[0]) : undefined;
  }

  async createTask(task: Task): Promise<Task> {
    task.status = task.column;
    if (task.retryCount == null) task.retryCount = 0;
    await this.pool.query(
      `INSERT INTO tasks (
        id, project_id, title, description, status, column_id, assignee, created_by, priority,
        tags, dependencies, subtasks, comments, next_task, parent_task_id, deadline,
        input_path, output_path, started_at, completed_at, failed_at, retry_count, max_retries,
        requires_review, duration_ms, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
      [
        task.id,
        task.projectId,
        task.title,
        task.description,
        task.status,
        task.column,
        task.assignee,
        task.createdBy,
        task.priority,
        toJson(task.tags),
        toJson(task.dependencies),
        toJson(task.subtasks),
        toJson(task.comments),
        task.nextTask ? JSON.stringify(task.nextTask) : null,
        task.parentTaskId ?? null,
        task.deadline ?? null,
        task.inputPath ?? null,
        task.outputPath ?? null,
        task.startedAt ?? null,
        task.completedAt ?? null,
        task.failedAt ?? null,
        task.retryCount,
        task.maxRetries ?? 2,
        !!task.requiresReview,
        task.durationMs ?? null,
        task.createdAt,
        task.updatedAt,
      ]
    );
    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<TaskRow>("SELECT * FROM tasks WHERE id = $1 FOR UPDATE", [id]);
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const existing = rowToTask(rows[0]);
      let merged: Task = { ...existing, ...updates, updatedAt: new Date().toISOString() };
      if (updates.column) {
        merged.status = updates.column;
      } else if (updates.status) {
        merged.column = updates.status;
        merged.status = updates.status;
      }
      await client.query(
        `UPDATE tasks SET
          project_id = $1,
          title = $2,
          description = $3,
          status = $4,
          column_id = $5,
          assignee = $6,
          created_by = $7,
          priority = $8,
          tags = $9,
          dependencies = $10,
          subtasks = $11,
          comments = $12,
          next_task = $13,
          parent_task_id = $14,
          deadline = $15,
          input_path = $16,
          output_path = $17,
          started_at = $18,
          completed_at = $19,
          failed_at = $20,
          retry_count = $21,
          max_retries = $22,
          requires_review = $23,
          duration_ms = $24,
          updated_at = $25
        WHERE id = $26`,
        [
          merged.projectId,
          merged.title,
          merged.description,
          merged.status,
          merged.column,
          merged.assignee,
          merged.createdBy,
          merged.priority,
          toJson(merged.tags),
          toJson(merged.dependencies),
          toJson(merged.subtasks),
          toJson(merged.comments),
          merged.nextTask ? JSON.stringify(merged.nextTask) : null,
          merged.parentTaskId ?? null,
          merged.deadline ?? null,
          merged.inputPath ?? null,
          merged.outputPath ?? null,
          merged.startedAt ?? null,
          merged.completedAt ?? null,
          merged.failedAt ?? null,
          merged.retryCount ?? 0,
          merged.maxRetries ?? 2,
          !!merged.requiresReview,
          merged.durationMs ?? null,
          merged.updatedAt,
          id,
        ]
      );
      await client.query("COMMIT");
      return merged;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteTask(id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM tasks WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async addComment(taskId: string, comment: { author: string; text: string }): Promise<Task | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<TaskRow>("SELECT * FROM tasks WHERE id = $1 FOR UPDATE", [taskId]);
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const task = rowToTask(rows[0]);
      task.comments.push({ ...comment, at: new Date().toISOString() });
      task.updatedAt = new Date().toISOString();
      await client.query(
        "UPDATE tasks SET comments = $1, updated_at = $2 WHERE id = $3",
        [toJson(task.comments), task.updatedAt, taskId]
      );
      await client.query("COMMIT");
      return task;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // Agents

  async getAgents(): Promise<Agent[]> {
    const { rows } = await this.pool.query<AgentRow>("SELECT * FROM agents");
    return rows.map(rowToAgent);
  }

  async registerAgent(agent: Agent): Promise<Agent> {
    await this.pool.query(
      `INSERT INTO agents (id, name, role, status, capabilities)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         status = EXCLUDED.status,
         capabilities = EXCLUDED.capabilities`,
      [agent.id, agent.name, agent.role, agent.status, toJson(agent.capabilities)]
    );
    return agent;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
