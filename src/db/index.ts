import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5435/public_sector_intel",
});

export const db = drizzle(pool, { schema });

// Export pool for direct queries when needed (e.g., vector operations)
export { pool };
