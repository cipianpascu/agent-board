import { Pool } from "pg";
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

export interface AuditEntry {
  timestamp: string;
  agentId: string;
  action: string;
  taskId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  details?: string;
}

export interface AuditStore {
  append(entry: AuditEntry): Promise<void>;
  read(filters?: {
    taskId?: string;
    agentId?: string;
    limit?: number;
  }): Promise<AuditEntry[]>;
}

let activeAuditStore: AuditStore | undefined;

export function getAuditStore(): AuditStore {
  if (!activeAuditStore) {
    activeAuditStore = new FileAuditStore();
  }
  return activeAuditStore;
}

export function setAuditStore(store: AuditStore): void {
  activeAuditStore = store;
}

export class FileAuditStore implements AuditStore {
  private dataDir: string;

  constructor(dataDir = "data") {
    this.dataDir = path.resolve(dataDir);
  }

  setDataDir(dir: string) {
    this.dataDir = path.resolve(dir);
  }

  private auditFilePath(): string {
    return path.join(this.dataDir, "audit.jsonl");
  }

  private ensureDir() {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async append(entry: AuditEntry): Promise<void> {
    this.ensureDir();
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(this.auditFilePath(), line);
  }

  async read(filters?: {
    taskId?: string;
    agentId?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const fp = this.auditFilePath();
    if (!existsSync(fp)) return [];

    const lines = readFileSync(fp, "utf-8").split("\n").filter(Boolean);
    let entries: AuditEntry[] = lines.map(line => JSON.parse(line));

    if (filters?.taskId) {
      entries = entries.filter(e => e.taskId === filters.taskId);
    }
    if (filters?.agentId) {
      entries = entries.filter(e => e.agentId === filters.agentId);
    }

    entries.reverse();

    if (filters?.limit && filters.limit > 0) {
      entries = entries.slice(0, filters.limit);
    }

    return entries;
  }
}

export interface AuditRow {
  id: number;
  timestamp: string;
  agent_id: string;
  action: string;
  task_id: string | null;
  project_id: string | null;
  from_col: string | null;
  to_col: string | null;
  details: string | null;
}

function rowToEntry(row: AuditRow): AuditEntry {
  return {
    timestamp: row.timestamp,
    agentId: row.agent_id,
    action: row.action,
    taskId: row.task_id ?? undefined,
    projectId: row.project_id ?? undefined,
    from: row.from_col ?? undefined,
    to: row.to_col ?? undefined,
    details: row.details ?? undefined,
  };
}

export class PostgresAuditStore implements AuditStore {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async append(entry: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (timestamp, agent_id, action, task_id, project_id, from_col, to_col, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.timestamp,
        entry.agentId,
        entry.action,
        entry.taskId ?? null,
        entry.projectId ?? null,
        entry.from ?? null,
        entry.to ?? null,
        entry.details ?? null,
      ]
    );
  }

  async read(filters?: {
    taskId?: string;
    agentId?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;

    if (filters?.taskId) {
      conditions.push(`task_id = $${idx++}`);
      params.push(filters.taskId);
    }
    if (filters?.agentId) {
      conditions.push(`agent_id = $${idx++}`);
      params.push(filters.agentId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    let query = `SELECT * FROM audit_events ${where} ORDER BY id DESC`;
    if (filters?.limit && filters.limit > 0) {
      query += ` LIMIT $${idx++}`;
      params.push(filters.limit);
    }

    const { rows } = await this.pool.query<AuditRow>(query, params);
    return rows.map(rowToEntry);
  }
}
