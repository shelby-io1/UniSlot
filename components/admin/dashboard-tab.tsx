"use client";

import type { DashboardStats } from "@/lib/services/dashboard";

export default function DashboardTab({ stats }: { stats: DashboardStats }) {
  const c = stats.counts;
  const cards: { label: string; value: number }[] = [
    { label: "Programs", value: c.programs },
    { label: "Batches", value: c.batches },
    { label: "Rooms", value: c.rooms },
    { label: "Teachers", value: c.teachers },
    { label: "Subjects", value: c.subjects },
    { label: "Periods", value: c.periods },
    { label: "Working days", value: c.workingDays },
    { label: "Batch subjects", value: c.batchSubjects },
    { label: "Audit entries", value: c.auditEntries },
    { label: "Import jobs", value: c.importJobs },
  ];

  const clash = stats.clashes;
  const clashCards: { label: string; value: number }[] = [
    { label: "Total clashes", value: clash.total },
    { label: "Batch", value: clash.batch },
    { label: "Course", value: clash.course },
    { label: "Teacher", value: clash.teacher },
    { label: "Room", value: clash.room },
    { label: "Repeater-involved", value: clash.repeatsInvolved },
  ];

  const termName = stats.term?.name ?? (stats.term ? `Term ${stats.term.id}` : null);

  return (
    <div className="admin-entity">
      <div className="admin-bar">
        <div>
          <h2 style={{ margin: 0 }}>Dashboard</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            Live counts from the database{termName ? ` · active term: ${termName}` : ""}.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        {cards.map((card) => (
          <div className="stat-card" key={card.label}>
            <span className="stat-value">{card.value.toLocaleString()}</span>
            <span className="stat-label">{card.label}</span>
          </div>
        ))}
      </div>

      <h3 className="stat-heading">Conflicts {termName ? `· ${termName}` : ""}</h3>
      {stats.term ? (
        <>
          <div className="stat-grid">
            {clashCards.map((card) => (
              <div className="stat-card" key={card.label}>
                <span className="stat-value">{card.value.toLocaleString()}</span>
                <span className="stat-label">{card.label}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            {clash.sessionsChecked.toLocaleString()} sessions checked in the active term.
          </p>
        </>
      ) : (
        <div className="empty">No academic term exists yet.</div>
      )}

      <h3 className="stat-heading">Recent imports</h3>
      {stats.recentImports.length === 0 ? (
        <div className="empty">No imports recorded.</div>
      ) : (
        <div className="admin-rows">
          {stats.recentImports.map((job) => (
            <div className="admin-row" key={job.id}>
              <div className="admin-row-head">
                <div className="t">
                  {job.kind}
                  <small>
                    {job.sourceName} · {new Date(job.createdAt).toLocaleString()}
                  </small>
                </div>
                <span className={`status-pill s-${job.status}`}>{job.status}</span>
              </div>
              <div className="admin-row-body" style={{ fontSize: 13 }}>
                {job.rowsImported.toLocaleString()} imported · {job.rowsFailed.toLocaleString()}{" "}
                failed · {job.rowsTotal.toLocaleString()} total
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
