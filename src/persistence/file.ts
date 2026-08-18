import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, unlinkSync, copyFileSync } from "fs";
import path from "path";
import { Project, Task, Agent } from "../types";
import { ProjectFilters, TaskFilters, Store } from "./types";

const MAX_BACKUPS = 50;

class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;
  async acquire(): Promise<() => void> {
    return new Promise(resolve => {
      const release = () => {
        const next = this.queue.shift();
        if (next) next();
        else this.locked = false;
      };
      if (!this.locked) { this.locked = true; resolve(release); }
      else this.queue.push(() => { resolve(release); });
    });
  }
}

const fileMutexes = new Map<string, AsyncMutex>();
function getMutex(name: string): AsyncMutex {
  if (!fileMutexes.has(name)) fileMutexes.set(name, new AsyncMutex());
  return fileMutexes.get(name)!;
}

export class FileStore implements Store {
  private dataDir: string;

  constructor(dataDir = "data") {
    this.dataDir = path.resolve(dataDir);
  }

  setDataDir(dir: string) {
    this.dataDir = path.resolve(dir);
  }

  private filePath(name: string): string {
    return path.join(this.dataDir, name);
  }

  private ensureDir() {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private readJSON<T>(name: string, fallback: T[]): T[] {
    this.ensureDir();
    const fp = this.filePath(name);
    if (!existsSync(fp)) {
      writeFileSync(fp, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    try {
      return JSON.parse(readFileSync(fp, "utf-8"));
    } catch {
      return fallback;
    }
  }

  private backupBeforeWrite(name: string) {
    const fp = this.filePath(name);
    if (!existsSync(fp)) return;

    const backupDir = path.join(this.dataDir, "backups");
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }

    const baseName = name.replace(/\.json$/, "");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${baseName}-${timestamp}.json`;
    copyFileSync(fp, path.join(backupDir, backupName));

    const allBackups = readdirSync(backupDir)
      .filter(f => f.startsWith(baseName + "-") && f.endsWith(".json"))
      .sort();

    if (allBackups.length > MAX_BACKUPS) {
      const toDelete = allBackups.slice(0, allBackups.length - MAX_BACKUPS);
      for (const old of toDelete) {
        unlinkSync(path.join(backupDir, old));
      }
    }
  }

  private writeJSON<T>(name: string, data: T[]) {
    this.ensureDir();
    this.backupBeforeWrite(name);
    const fp = this.filePath(name);
    const tmp = fp + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, fp);
  }

  private async withLock<T>(name: string, fn: (data: T[]) => T[]): Promise<T[]> {
    const release = await getMutex(name).acquire();
    try {
      const data = this.readJSON<T>(name, []);
      const result = fn(data);
      this.writeJSON(name, result);
      return result;
    } finally {
      release();
    }
  }

  // Projects

  async getProjects(filters?: ProjectFilters): Promise<Project[]> {
    let projects = this.readJSON<Project>("projects.json", []);
    if (filters?.status) projects = projects.filter(p => p.status === filters.status);
    if (filters?.owner) projects = projects.filter(p => p.owner === filters.owner);
    return projects;
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.readJSON<Project>("projects.json", []).find(p => p.id === id);
  }

  async createProject(project: Project): Promise<Project> {
    await this.withLock<Project>("projects.json", (projects) => {
      projects.push(project);
      return projects;
    });
    return project;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    let result: Project | undefined;
    await this.withLock<Project>("projects.json", (projects) => {
      const idx = projects.findIndex(p => p.id === id);
      if (idx === -1) { result = undefined; return projects; }
      projects[idx] = { ...projects[idx], ...updates, updatedAt: new Date().toISOString() };
      result = projects[idx];
      return projects;
    });
    return result;
  }

  async deleteProject(id: string): Promise<boolean> {
    let found = false;
    await this.withLock<Project>("projects.json", (projects) => {
      const idx = projects.findIndex(p => p.id === id);
      if (idx === -1) { found = false; return projects; }
      projects.splice(idx, 1);
      found = true;
      return projects;
    });
    if (!found) return false;
    await this.withLock<Task>("tasks.json", (tasks) => {
      return tasks.filter(t => t.projectId !== id);
    });
    return true;
  }

  // Tasks

  async getTasks(filters?: TaskFilters): Promise<Task[]> {
    let tasks = this.readJSON<Task>("tasks.json", []);
    if (filters?.projectId) tasks = tasks.filter(t => t.projectId === filters.projectId);
    if (filters?.assignee) tasks = tasks.filter(t => t.assignee === filters.assignee);
    if (filters?.status) tasks = tasks.filter(t => t.status === filters.status || t.column === filters.status);
    if (filters?.tag) tasks = tasks.filter(t => t.tags.includes(filters.tag!));
    return tasks;
  }

  async getTask(id: string): Promise<Task | undefined> {
    return this.readJSON<Task>("tasks.json", []).find(t => t.id === id);
  }

  async createTask(task: Task): Promise<Task> {
    task.status = task.column;
    if (task.retryCount == null) task.retryCount = 0;
    await this.withLock<Task>("tasks.json", (tasks) => {
      tasks.push(task);
      return tasks;
    });
    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    let result: Task | undefined;
    await this.withLock<Task>("tasks.json", (tasks) => {
      const idx = tasks.findIndex(t => t.id === id);
      if (idx === -1) { result = undefined; return tasks; }
      const updated = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
      if (updates.column) {
        updated.status = updates.column;
      } else if (updates.status) {
        updated.column = updates.status;
        updated.status = updates.status;
      }
      tasks[idx] = updated;
      result = tasks[idx];
      return tasks;
    });
    return result;
  }

  async deleteTask(id: string): Promise<boolean> {
    let found = false;
    await this.withLock<Task>("tasks.json", (tasks) => {
      const idx = tasks.findIndex(t => t.id === id);
      if (idx === -1) { found = false; return tasks; }
      tasks.splice(idx, 1);
      found = true;
      return tasks;
    });
    return found;
  }

  async addComment(taskId: string, comment: { author: string; text: string }): Promise<Task | undefined> {
    let result: Task | undefined;
    await this.withLock<Task>("tasks.json", (tasks) => {
      const idx = tasks.findIndex(t => t.id === taskId);
      if (idx === -1) { result = undefined; return tasks; }
      tasks[idx].comments.push({ ...comment, at: new Date().toISOString() });
      tasks[idx].updatedAt = new Date().toISOString();
      result = tasks[idx];
      return tasks;
    });
    return result;
  }

  // Agents

  async getAgents(): Promise<Agent[]> {
    return this.readJSON<Agent>("agents.json", []);
  }

  async registerAgent(agent: Agent): Promise<Agent> {
    await this.withLock<Agent>("agents.json", (agents) => {
      const idx = agents.findIndex(a => a.id === agent.id);
      if (idx >= 0) {
        agents[idx] = agent;
      } else {
        agents.push(agent);
      }
      return agents;
    });
    return agent;
  }

  close() {
    // no-op for file backend
  }
}
