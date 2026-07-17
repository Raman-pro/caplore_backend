import pg from "pg";
import { config } from "../lib/config.mjs";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});
