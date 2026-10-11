import { connection } from "next/server";
import { json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getMeta } from "@/lib/services/timetable";

export async function GET() {
  await connection();
  try {
    const db = await getDb();
    return json(await getMeta(db));
  } catch (error) {
    console.error("meta failed", error);
    return serverError("Unable to load reference data");
  }
}
