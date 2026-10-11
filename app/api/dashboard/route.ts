import { connection } from "next/server";
import { json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getDashboardStats } from "@/lib/services/dashboard";

/** GET /api/dashboard — live counts for the admin dashboard tab. */
export async function GET() {
  await connection();
  try {
    const db = await getDb();
    return json(await getDashboardStats(db));
  } catch (error) {
    console.error("dashboard failed", error);
    return serverError("Unable to load dashboard");
  }
}
