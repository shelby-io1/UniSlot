import type { PgDatabase } from "drizzle-orm/pg-core";
import { schema } from "./schema";

type ClosableClient = { end?: () => Promise<unknown>; close?: () => Promise<unknown> };

/**
 * A single database facade. The concrete driver is chosen at runtime:
 *
 * - `DATABASE_URL` present  -> postgres.js against the Neon serverless Postgres.
 * - `DATABASE_URL` absent   -> in-memory PGlite (WASM Postgres). No install and
 *   nothing persisted on disk, so local development never requires a physical
 *   database. Data is reseeded on every process start.
 *
 * `PGLITE_DATA_DIR` may be set to persist the PGlite instance for experiments.
 */
export type Database = PgDatabase<never, typeof schema>;

let ready: Promise<Database> | null = null;
let activeClient: ClosableClient | null = null;

export type DriverInfo = { driver: "postgres" | "pglite"; persistent: boolean };

export function describeDriver(): DriverInfo {
  if (process.env.DATABASE_URL) return { driver: "postgres", persistent: true };
  return { driver: "pglite", persistent: Boolean(process.env.PGLITE_DATA_DIR) };
}

async function init(): Promise<Database> {
  const migrationsFolder = "drizzle";

  if (process.env.DATABASE_URL) {
    const [{ drizzle }, { migrate }, { default: postgres }, { seedDatabase, ensureBatchSubjects }] =
      await Promise.all([
        import("drizzle-orm/postgres-js"),
        import("drizzle-orm/postgres-js/migrator"),
        import("postgres"),
        import("./seed"),
      ]);
    const client = postgres(process.env.DATABASE_URL, { max: 5, prepare: false });
    activeClient = client as ClosableClient;
    const db = drizzle(client, { schema }) as unknown as Database;
    await migrate(db as never, { migrationsFolder });
    await seedDatabase(db);
    await ensureBatchSubjects(db);
    return db;
  }

  const [{ drizzle }, { migrate }, { PGlite }, { seedDatabase, ensureBatchSubjects }] =
    await Promise.all([
      import("drizzle-orm/pglite"),
      import("drizzle-orm/pglite/migrator"),
      import("@electric-sql/pglite"),
      import("./seed"),
    ]);
  const client = process.env.PGLITE_DATA_DIR
    ? new PGlite(process.env.PGLITE_DATA_DIR)
    : new PGlite();
  activeClient = client as ClosableClient;
  const db = drizzle(client, { schema }) as unknown as Database;
  await migrate(db as never, { migrationsFolder });
  await seedDatabase(db);
  await ensureBatchSubjects(db);
  return db;
}

export function getDb(): Promise<Database> {
  ready ??= init();
  return ready;
}

/** Closes the active driver. CLI scripts call this so the process can exit. */
export async function closeDb(): Promise<void> {
  const client = activeClient;
  activeClient = null;
  ready = null;
  if (!client) return;
  if (client.end) await client.end();
  else if (client.close) await client.close();
}
