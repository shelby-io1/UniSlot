import { existsSync } from "node:fs";
import { count } from "drizzle-orm";
import { getDb, describeDriver, closeDb } from "../../lib/db";
import { batches, classSessions, programs, rooms, subjects, teachers } from "../../lib/db/schema";

async function main() {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  const info = describeDriver();
  const db = await getDb();
  const [p] = await db.select({ n: count() }).from(programs);
  const [b] = await db.select({ n: count() }).from(batches);
  const [r] = await db.select({ n: count() }).from(rooms);
  const [t] = await db.select({ n: count() }).from(teachers);
  const [s] = await db.select({ n: count() }).from(subjects);
  const [c] = await db.select({ n: count() }).from(classSessions);

  console.log("driver:", info.driver, "persistent:", info.persistent);
  console.log(
    `programs=${p.n} batches=${b.n} rooms=${r.n} teachers=${t.n} subjects=${s.n} sessions=${c.n}`,
  );

  await closeDb();

  if (b.n !== 56 || r.n !== 39 || t.n !== 99 || s.n !== 200 || c.n !== 813) {
    console.error("seed verification failed: unexpected row counts");
    process.exit(1);
  }
  console.log("database ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

