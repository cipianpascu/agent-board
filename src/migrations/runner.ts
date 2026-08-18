import fs from "fs";
import path from "path";
import { Pool } from "pg";

export interface RunMigrationsOptions {
  migrationsDir?: string;
  lockKey?: number;
}

const DEFAULT_MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations", "postgres");
const DEFAULT_LOCK_KEY = 424242;

export async function runMigrations(pool: Pool, options: RunMigrationsOptions = {}): Promise<void> {
  const migrationsDir = options.migrationsDir ?? process.env.MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS_DIR;
  const lockKey = options.lockKey ?? DEFAULT_LOCK_KEY;

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const version = path.basename(file, ".sql");
      const { rows } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [version]
      );
      if (rows.length > 0) continue;

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf-8");

      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [version]
      );
      console.log(`[migrations] applied ${version}`);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
