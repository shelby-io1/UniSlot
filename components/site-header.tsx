"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const MENU_LINKS = [
  { href: "/", label: "Home" },
  { href: "/rooms", label: "Free Rooms" },
  { href: "/faculty", label: "Free Faculty" },
  { href: "/teacher-timetable", label: "Faculty Timetable" },
  { href: "/batch-timetable", label: "Batch Timetable" },
];

export default function SiteHeader({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const onAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    // Re-check the session when the tab regains focus, so signing in or out in
    // another tab (the admin panel opens in a new tab) is reflected here.
    const recheck = () => {
      if (document.visibilityState !== "hidden") router.refresh();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [router]);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/admin/session", { method: "DELETE", keepalive: true });
    } catch {
      // ignore — the cookie may already be gone
    }
    setOpen(false);
    // The admin panel is normally opened in its own tab; close it if possible.
    window.close();
    // If the browser refused to close the tab, refresh to the signed-out view.
    router.refresh();
    setSigningOut(false);
  }

  return (
    <div className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/comsats-logo.jpg" alt="COMSATS University logo" />
          <span className="brand-name">
            UniSlot
            <small>COMSATS Attock Campus</small>
          </span>
        </Link>

        <nav className={`menu${open ? " open" : ""}`}>
          {!onAdmin &&
            MENU_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={pathname === link.href ? "active" : ""}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          {isAdmin ? (
            <button
              type="button"
              className="admin-btn on"
              onClick={signOut}
              disabled={signingOut}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          ) : onAdmin ? null : (
            <Link
              href="/admin"
              className="admin-btn"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
            >
              Admin Panel
            </Link>
          )}
        </nav>

        <button
          type="button"
          className="menu-toggle"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </div>
  );
}
