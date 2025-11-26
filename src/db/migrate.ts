import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;

async function main() {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5435/public_sector_intel",
  });

  const db = drizzle(pool);

  console.log("Enabling pgvector extension...");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");

  console.log("Running migrations...");
  const migrationsFolder = process.env.NODE_ENV === "production"
    ? "./dist/db/migrations"
    : "./src/db/migrations";
  await migrate(db, { migrationsFolder });

  console.log("Creating vector indexes (HNSW)...");
  // Create HNSW indexes - better than IVFFlat for smaller datasets
  // HNSW doesn't require a training phase and works well regardless of data size
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_embedding
    ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
  `).catch((err) => {
    // Index might already exist
    console.log("Chunks vector index:", err.message.includes("already exists") ? "already exists" : err.message);
  });

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_projects_embedding
    ON projects USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
  `).catch((err) => {
    console.log("Projects vector index:", err.message.includes("already exists") ? "already exists" : err.message);
  });

  console.log("Migrations complete!");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
