import { count, desc, lt } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

/**
 * Audit log read model (Phase 6). Audit rows are append-only and written by the
 * mutation paths (admin CRUD, imports, resolution apply). Reads paginate
 * newest-first by id, which is a stable cursor because ids are serial.
 */

export type AuditEntry = {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  actor: string | null;
  detail: unknown;
  createdAt: string;
};

export type AuditPage = {
  entries: AuditEntry[];
  /** Pass as `beforeId` to fetch the next (older) page; null at the end. */
  nextId: number | null;
};

export const AUDIT_PAGE_SIZE = 50;

function toEntry(row: typeof auditLogs.$inferSelect): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    actor: row.actor,
    detail: row.detail ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

/** Newest-first page of audit entries, with a cursor for the next page. */
export async function listAuditEntries(
  db: Database,
  opts: { limit?: number; beforeId?: number } = {},
): Promise<AuditPage> {
  const limit = Math.min(Math.max(opts.limit ?? AUDIT_PAGE_SIZE, 1), 200);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(opts.beforeId !== undefined ? lt(auditLogs.id, opts.beforeId) : undefined)
    .orderBy(desc(auditLogs.id))
    .limit(limit);

  const entries = rows.map(toEntry);
  const nextId = rows.length === limit ? rows[rows.length - 1].id : null;
  return { entries, nextId };
}

export async function countAuditEntries(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(auditLogs);
  return row?.n ?? 0;
}
