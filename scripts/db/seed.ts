import { existsSync } from "node:fs";
import { count } from "drizzle-orm";
import dataset from "../../data/seed/cui-space-dataset.json";
import { getDb, describeDriver, closeDb } from "../../lib/db";
import { batches, classSessions, programs, rooms, subjects, teachers } from "../../lib/db/schema";

async function main() {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  process.env.DB_AUTO_SETUP = "1";
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

  // Reference rows must match the dataset exactly. Subjects are a minimum:
  // `npm run import:catalog` augments the seeded set with the course catalog.
  const expected = {
    batches: dataset.batches.length,
    rooms: dataset.rooms.length,
    teachers: dataset.teachers.length,
    sessions: dataset.entries.length,
    subjects: dataset.subjects.length,
  };
  if (
    b.n !== expected.batches ||
    r.n !== expected.rooms ||
    t.n !== expected.teachers ||
    c.n !== expected.sessions ||
    s.n < expected.subjects
  ) {
    console.error(
      `seed verification failed: expected batches>=${expected.batches} rooms>=${expected.rooms} ` +
        `teachers>=${expected.teachers} subjects>=${expected.subjects} sessions>=${expected.sessions}, ` +
        `got batches=${b.n} rooms=${r.n} teachers=${t.n} subjects=${s.n} sessions=${c.n}`,
    );
    process.exit(1);
  }
  console.log("database ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

