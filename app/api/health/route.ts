import { count } from "drizzle-orm";
import { connection } from "next/server";
import { json, serverError } from "@/lib/api";
import { describeDriver, getDb } from "@/lib/db";
import { classSessions, rooms, subjects, teachers, batches } from "@/lib/db/schema";

export async function GET() {
  await connection();
  try {
    const db = await getDb();
    const driver = describeDriver();
    const [sessions] = await db.select({ n: count() }).from(classSessions);
    const [roomCount] = await db.select({ n: count() }).from(rooms);
    const [teacherCount] = await db.select({ n: count() }).from(teachers);
    const [subjectCount] = await db.select({ n: count() }).from(subjects);
    const [batchCount] = await db.select({ n: count() }).from(batches);

    return json({
      status: "ok",
      driver: driver.driver,
      persistent: driver.persistent,
      counts: {
        sessions: sessions.n,
        rooms: roomCount.n,
        teachers: teacherCount.n,
        subjects: subjectCount.n,
        batches: batchCount.n,
      },
    });
  } catch (error) {
    console.error("health check failed", error);
    return serverError("Health check failed");
  }
}
