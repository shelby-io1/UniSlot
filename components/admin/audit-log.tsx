"use client";

import { useState, useTransition } from "react";
import { loadAuditAction } from "@/app/admin/actions";
import type { AuditEntry } from "@/lib/services/audit";

export default function AuditLog({
  entries: initialEntries,
  nextId: initialNextId,
}: {
  entries: AuditEntry[];
  nextId: number | null;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [nextId, setNextId] = useState(initialNextId);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function loadOlder() {
    if (nextId === null) return;
    const fd = new FormData();
    fd.set("before", String(nextId));
    start(async () => {
      const res = await loadAuditAction({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setEntries((prev) => [...prev, ...(res.entries ?? [])]);
      setNextId(res.nextId ?? null);
    });
  }

  return (
    <div className="admin-entity">
      <div className="admin-bar">
        <div>
          <h2 style={{ margin: 0 }}>Audit log</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            Every recorded mutation, newest first.
          </p>
        </div>
      </div>

      {error ? <div className="note error">{error}</div> : null}

      {entries.length === 0 ? (
        <div className="empty">No audit entries yet.</div>
      ) : (
        <div className="audit-list">
          {entries.map((entry) => (
            <div className="audit-item" key={entry.id}>
              <div className="audit-main">
                <span className="audit-action">{entry.action}</span>
                <span className="muted">
                  {entry.entity}
                  {entry.entityId ? ` #${entry.entityId}` : ""} · {entry.actor ?? "system"} ·{" "}
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
              {entry.detail ? (
                <pre className="audit-detail">{JSON.stringify(entry.detail, null, 2)}</pre>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {nextId !== null ? (
        <div className="admin-top">
          <button type="button" className="btn" onClick={loadOlder} disabled={pending}>
            {pending ? "Loading…" : "Load older"}
          </button>
        </div>
      ) : entries.length > 0 ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          End of log.
        </p>
      ) : null}
    </div>
  );
}
