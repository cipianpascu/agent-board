#!/usr/bin/env node
import { Pool } from "pg";
import { runMigrations } from "./migrations/runner";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: url });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
