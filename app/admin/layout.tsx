import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main className="admin-main">
      <h2 className="page-title">Admin Panel</h2>
      <p className="page-sub">Manage programs, batches, subjects, teachers, rooms and periods.</p>
      {children}
    </main>
  );
}
