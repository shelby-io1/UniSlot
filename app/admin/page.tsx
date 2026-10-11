import { Suspense } from "react";
import AdminDashboard from "@/components/admin/dashboard";
import AdminLogin from "@/components/admin/login";
import { ENTITY_SCHEMAS } from "@/lib/admin/entities";
import { isAdminAuthenticated } from "@/lib/admin/session";
import { getDb } from "@/lib/db";
import { ADMIN_ENTITIES, listEntity } from "@/lib/services/admin";
import { listAuditEntries } from "@/lib/services/audit";
import { listBatchSubjects } from "@/lib/services/batch-subjects";
import { getDashboardStats } from "@/lib/services/dashboard";
import { getTheme } from "@/lib/services/settings";

export const metadata = { title: "UniSlot Admin" };

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="empty">Loading…</div>}>
      <AdminGate />
    </Suspense>
  );
}

async function AdminGate() {
  if (!(await isAdminAuthenticated())) return <AdminLogin />;

  const db = await getDb();
  const data: Record<string, Record<string, unknown>[]> = {};
  for (const key of ADMIN_ENTITIES) {
    data[key] = (await listEntity(db, key)) as Record<string, unknown>[];
  }
  const assignments = await listBatchSubjects(db);
  const theme = await getTheme(db);
  const [stats, audit] = await Promise.all([
    getDashboardStats(db),
    listAuditEntries(db, { limit: 100 }),
  ]);
  return (
    <AdminDashboard
      schemas={ENTITY_SCHEMAS}
      data={data}
      assignments={assignments}
      theme={theme}
      stats={stats}
      auditEntries={audit.entries}
      auditNextId={audit.nextId}
    />
  );
}
