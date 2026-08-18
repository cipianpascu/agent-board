import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { FileStore } from "./file";
import { SqliteStore, migrateSqlite } from "./sqlite";
import { PostgresStore, migratePostgres } from "./postgres";
import { Store } from "./types";
import { FileAuditStore, PostgresAuditStore, setAuditStore } from "./audit";

let activeStore: Store | undefined;

export function getStore(): Store {
  if (!activeStore) {
    activeStore = new FileStore();
  }
  return activeStore;
}

export function setStore(store: Store): void {
  activeStore = store;
}

export async function closeStore(): Promise<void> {
  if (activeStore?.close) {
    await activeStore.close();
  }
  activeStore = undefined;
}

export function isPostgresUrl(url: string | undefined): boolean {
  return !!url && (url.startsWith("postgresql://") || url.startsWith("postgres://"));
}

export interface InitOptions {
  dataDir?: string;
  dbPath?: string;
}

export function initSqliteDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 10000");
  migrateSqlite(db);
  console.log(`[db] SQLite initialized at ${dbPath}`);
  return db;
}

export async function initPostgresDatabase(connectionString: string): Promise<void> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString });
  await migratePostgres(pool);
  await pool.end();
}

export async function initStore(options: InitOptions = {}): Promise<Store> {
  const backend = process.env.AGENTBOARD_STORE || "file";
  const dataDir = options.dataDir ?? process.env.AGENTBOARD_DATA_DIR ?? "data";

  if (backend === "postgres" || isPostgresUrl(process.env.DATABASE_URL)) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is required for PostgreSQL backend");
    }
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    await migratePostgres(pool);
    const store = new PostgresStore(pool);
    setStore(store);
    setAuditStore(new PostgresAuditStore(pool));
    console.log("[db] PostgreSQL backend active");
    return store;
  }

  if (backend === "sqlite") {
    const dbPath = options.dbPath ?? process.env.DB_PATH ?? path.join(dataDir, "agentboard.db");
    const db = initSqliteDatabase(dbPath);
    const store = new SqliteStore(db);
    setStore(store);
    setAuditStore(new FileAuditStore(dataDir));
    console.log("[db] SQLite backend active");
    return store;
  }

  const store = new FileStore(dataDir);
  setStore(store);
  setAuditStore(new FileAuditStore(dataDir));
  console.log(`[db] File backend active at ${dataDir}`);
  return store;
}
