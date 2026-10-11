import type { ReactNode } from "react";
import Link from "next/link";

type Tool = { tag: string; title: string; desc: string; icon: ReactNode };

const PUBLIC_TOOLS: Tool[] = [
  {
    tag: "Rooms",
    title: "Free Rooms Now",
    desc: "See every classroom, lab and lecture hall that is free for a chosen day and slot.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 21h18" />
        <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
        <path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M12 21v-4" />
      </svg>
    ),
  },
  {
    tag: "Faculty",
    title: "Free Faculty Now",
    desc: "Find teachers who are not in a class during a selected day and slot.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
      </svg>
    ),
  },
  {
    tag: "Timetable",
    title: "Faculty Timetable",
    desc: "Open any teacher's full weekly schedule at a glance.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
        <path d="M8 13h3v3H8z" />
      </svg>
    ),
  },
  {
    tag: "Timetable",
    title: "Batchwise Timetable",
    desc: "Browse the weekly timetable for any batch or programme.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18" />
      </svg>
    ),
  },
];

const ADMIN_TOOLS: Tool[] = [
  {
    tag: "Engine",
    title: "Timetable Generation",
    desc: "Build a full weekly schedule from batches, subjects, teachers and rooms.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
      </svg>
    ),
  },
  {
    tag: "Engine",
    title: "Clash Detection",
    desc: "Scan the timetable for batch, course, teacher and room clashes.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    ),
  },
  {
    tag: "Engine",
    title: "Clash Resolution",
    desc: "Move a clashing session to a free slot and re-validate the whole term.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </svg>
    ),
  },
];

function ToolCard({ tool, admin }: { tool: Tool; admin?: boolean }) {
  return (
    <div className="tool-card">
      <span className="tool-icon">{tool.icon}</span>
      <span className="tool-badges">
        <span className="tool-tag">{tool.tag}</span>
        {admin ? (
          <span className="tool-admin">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Admin only
          </span>
        ) : null}
      </span>
      <h3>{tool.title}</h3>
      <p>{tool.desc}</p>
    </div>
  );
}

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-eyebrow">COMSATS University Islamabad · Attock Campus</span>
          <h1 className="hero-title">UniSlot</h1>
          <p className="hero-lede">
            Generate a term&rsquo;s timetable, detect and resolve clashes, and find free rooms and
            faculty — all in one place.
          </p>
          <div className="hero-cta">
            <Link href="/rooms" className="btn hero-primary">
              Find a free room
            </Link>
            <Link href="/batch-timetable" className="btn hero-secondary">
              Browse timetables
            </Link>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">Tools</h2>
          <p className="section-sub">Free rooms, free faculty and weekly timetables.</p>
        </div>
        <div className="tool-grid">
          {PUBLIC_TOOLS.map((tool) => (
            <ToolCard key={tool.title} tool={tool} />
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">Admin control</h2>
          <p className="section-sub">
            The timetable engine — generation, clash detection and resolution, run from the admin
            panel.
          </p>
        </div>
        <div className="tool-grid">
          {ADMIN_TOOLS.map((tool) => (
            <ToolCard key={tool.title} tool={tool} admin />
          ))}
        </div>
      </section>
    </main>
  );
}
