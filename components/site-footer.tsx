"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const FOOTER_LINKS = [
  { href: "/", label: "Home" },
  { href: "/rooms", label: "Free Rooms Now" },
  { href: "/faculty", label: "Free Faculty Now" },
  { href: "/teacher-timetable", label: "Faculty Timetable" },
  { href: "/batch-timetable", label: "Batchwise Timetable" },
  { href: "/admin", label: "Admin Panel" },
];

export default function SiteFooter() {
  const pathname = usePathname();
  const onAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-block">
          <p className="dev-name">Developed by Shahid Zahoor Khan</p>
          <p>
            UniSlot — COMSATS University Islamabad, Attock Campus. Find available rooms, labs and
            teachers by time slot, and browse faculty and batch timetables.
          </p>
        </div>

        {!onAdmin && (
          <div className="footer-block">
            <h4>Navigation</h4>
            <nav className="footer-nav">
              {FOOTER_LINKS.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        )}

        <div className="footer-block">
          <h4>Credits</h4>
          <p>Built with Next.js, React and a Neon Postgres / Drizzle backend.</p>
          <p>Timetable data sourced from the campus Batchwise schedule.</p>
        </div>
      </div>

      <div className="footer-copy">
        © UniSlot · COMSATS Attock Campus. All rights reserved.
      </div>
    </footer>
  );
}
