import Database from "better-sqlite3";
import { Project, Task, Agent, Comment, NextTask } from "../types";
import { ProjectFilters, TaskFilters, Store } from "./types";

export interface ProjectRow {
  id: string;
  name: string;
  status: string;
  owner: string;
  description: string;
  client_view_enabled: number;
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
  requires_review: number;
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
    clientViewEnabled: !!row.client_view_enabled,
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
    requiresReview: !!row.requires_review,
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

export function migrateSqlite(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      status              TEXT NOT NULL,
      owner               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      client_view_enabled INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
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
      requires_review INTEGER NOT NULL DEFAULT 0,
      duration_ms     INTEGER,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL,
      capabilities  TEXT NOT NULL DEFAULT '[]'
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_column_id ON tasks(column_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
}

export class SqliteStore implements Store {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async ready(): Promise<void> {
    this.db.prepare("SELECT 1").get();
  }

  // Projects

  async getProjects(filters?: ProjectFilters): Promise<Project[]> {
    const rows = this.db.prepare("SELECT * FROM projects").all() as ProjectRow[];
    let projects = rows.map(rowToProject);
    if (filters?.status) projects = projects.filter(p => p.status === filters.status);
    if (filters?.owner) projects = projects.filter(p => p.owner === filters.owner);
    return projects;
  }

  async getProject(id: string): Promise<Project | undefined> {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? rowToProject(row) : undefined;
  }

  async createProject(project: Project): Promise<Project> {
    this.db.prepare(`
      INSERT INTO projects (id, name, status, owner, description, client_view_enabled, created_at, updated_at)
      VALUES (@id, @name, @status, @owner, @description, @client_view_enabled, @created_at, @updated_at)
    `).run({
      id: project.id,
      name: project.name,
      status: project.status,
      owner: project.owner,
      description: project.description,
      client_view_enabled: project.clientViewEnabled ? 1 : 0,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    });
    return project;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
      if (!row) return undefined;
      const existing = rowToProject(row);
      const merged: Project = { ...existing, ...updates, updatedAt: new Date().toISOString() };
      this.db.prepare(`
        UPDATE projects
        SET name = @name,
            status = @status,
            owner = @owner,
            description = @description,
            client_view_enabled = @client_view_enabled,
            updated_at = @updated_at
        WHERE id = @id
      `).run({
        id,
        name: merged.name,
        status: merged.status,
        owner: merged.owner,
        description: merged.description,
        client_view_enabled: merged.clientViewEnabled ? 1 : 0,
        updated_at: merged.updatedAt,
      });
      return merged;
    })();
  }

  async deleteProject(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // Tasks

  async getTasks(filters?: TaskFilters): Promise<Task[]> {
    const rows = this.db.prepare("SELECT * FROM tasks").all() as TaskRow[];
    let tasks = rows.map(rowToTask);
    if (filters?.projectId) tasks = tasks.filter(t => t.projectId === filters.projectId);
    if (filters?.assignee) tasks = tasks.filter(t => t.assignee === filters.assignee);
    if (filters?.status) tasks = tasks.filter(t => t.status === filters.status || t.column === filters.status);
    if (filters?.tag) tasks = tasks.filter(t => t.tags.includes(filters.tag!));
    return tasks;
  }

  async getTask(id: string): Promise<Task | undefined> {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  async createTask(task: Task): Promise<Task> {
    task.status = task.column;
    if (task.retryCount == null) task.retryCount = 0;
    this.db.prepare(`
      INSERT INTO tasks (
        id, project_id, title, description, status, column_id, assignee, created_by, priority,
        tags, dependencies, subtasks, comments, next_task, parent_task_id, deadline,
        input_path, output_path, started_at, completed_at, failed_at, retry_count, max_retries,
        requires_review, duration_ms, created_at, updated_at
      ) VALUES (
        @id, @project_id, @title, @description, @status, @column_id, @assignee, @created_by, @priority,
        @tags, @dependencies, @subtasks, @comments, @next_task, @parent_task_id, @deadline,
        @input_path, @output_path, @started_at, @completed_at, @failed_at, @retry_count, @max_retries,
        @requires_review, @duration_ms, @created_at, @updated_at
      )
    `).run({
      id: task.id,
      project_id: task.projectId,
      title: task.title,
      description: task.description,
      status: task.status,
      column_id: task.column,
      assignee: task.assignee,
      created_by: task.createdBy,
      priority: task.priority,
      tags: toJson(task.tags),
      dependencies: toJson(task.dependencies),
      subtasks: toJson(task.subtasks),
      comments: toJson(task.comments),
      next_task: task.nextTask ? JSON.stringify(task.nextTask) : null,
      parent_task_id: task.parentTaskId ?? null,
      deadline: task.deadline ?? null,
      input_path: task.inputPath ?? null,
      output_path: task.outputPath ?? null,
      started_at: task.startedAt ?? null,
      completed_at: task.completedAt ?? null,
      failed_at: task.failedAt ?? null,
      retry_count: task.retryCount,
      max_retries: task.maxRetries ?? 2,
      requires_review: task.requiresReview ? 1 : 0,
      duration_ms: task.durationMs ?? null,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    });
    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
      if (!row) return undefined;
      const existing = rowToTask(row);
      let merged: Task = { ...existing, ...updates, updatedAt: new Date().toISOString() };
      if (updates.column) {
        merged.status = updates.column;
      } else if (updates.status) {
        merged.column = updates.status;
        merged.status = updates.status;
      }
      this.db.prepare(`
        UPDATE tasks SET
          project_id = @project_id,
          title = @title,
          description = @description,
          status = @status,
          column_id = @column_id,
          assignee = @assignee,
          created_by = @created_by,
          priority = @priority,
          tags = @tags,
          dependencies = @dependencies,
          subtasks = @subtasks,
          comments = @comments,
          next_task = @next_task,
          parent_task_id = @parent_task_id,
          deadline = @deadline,
          input_path = @input_path,
          output_path = @output_path,
          started_at = @started_at,
          completed_at = @completed_at,
          failed_at = @failed_at,
          retry_count = @retry_count,
          max_retries = @max_retries,
          requires_review = @requires_review,
          duration_ms = @duration_ms,
          updated_at = @updated_at
        WHERE id = @id
      `).run({
        id,
        project_id: merged.projectId,
        title: merged.title,
        description: merged.description,
        status: merged.status,
        column_id: merged.column,
        assignee: merged.assignee,
        created_by: merged.createdBy,
        priority: merged.priority,
        tags: toJson(merged.tags),
        dependencies: toJson(merged.dependencies),
        subtasks: toJson(merged.subtasks),
        comments: toJson(merged.comments),
        next_task: merged.nextTask ? JSON.stringify(merged.nextTask) : null,
        parent_task_id: merged.parentTaskId ?? null,
        deadline: merged.deadline ?? null,
        input_path: merged.inputPath ?? null,
        output_path: merged.outputPath ?? null,
        started_at: merged.startedAt ?? null,
        completed_at: merged.completedAt ?? null,
        failed_at: merged.failedAt ?? null,
        retry_count: merged.retryCount ?? 0,
        max_retries: merged.maxRetries ?? 2,
        requires_review: merged.requiresReview ? 1 : 0,
        duration_ms: merged.durationMs ?? null,
        updated_at: merged.updatedAt,
      });
      return merged;
    })();
  }

  async deleteTask(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return result.changes > 0;
  }

  async addComment(taskId: string, comment: { author: string; text: string }): Promise<Task | undefined> {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
      if (!row) return undefined;
      const task = rowToTask(row);
      task.comments.push({ ...comment, at: new Date().toISOString() });
      task.updatedAt = new Date().toISOString();
      this.db.prepare("UPDATE tasks SET comments = @comments, updated_at = @updated_at WHERE id = @id").run({
        id: taskId,
        comments: toJson(task.comments),
        updated_at: task.updatedAt,
      });
      return task;
    })();
  }

  // Agents

  async getAgents(): Promise<Agent[]> {
    const rows = this.db.prepare("SELECT * FROM agents").all() as AgentRow[];
    return rows.map(rowToAgent);
  }

  async registerAgent(agent: Agent): Promise<Agent> {
    this.db.prepare(`
      INSERT INTO agents (id, name, role, status, capabilities)
      VALUES (@id, @name, @role, @status, @capabilities)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        role = excluded.role,
        status = excluded.status,
        capabilities = excluded.capabilities
    `).run({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      capabilities: toJson(agent.capabilities),
    });
    return agent;
  }

  close() {
    this.db.close();
  }
}
