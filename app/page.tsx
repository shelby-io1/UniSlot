import Link from "next/link";

const TOOLS = [
  {
    href: "/rooms",
    tag: "Rooms",
    title: "Free Rooms Now",
    desc: "See every classroom, lab and lecture hall that is free for a chosen day and slot.",
  },
  {
    href: "/faculty",
    tag: "Faculty",
    title: "Free Faculty Now",
    desc: "Find teachers who are not in a class during a selected day and slot.",
  },
  {
    href: "/teacher-timetable",
    tag: "Timetable",
    title: "Faculty Timetable",
    desc: "Open any teacher's full weekly schedule at a glance.",
  },
  {
    href: "/batch-timetable",
    tag: "Timetable",
    title: "Batchwise Timetable",
    desc: "Browse the weekly timetable for any batch or programme.",
  },
];

export default function Home() {
  return (
    <main>
      <section className="home-hero">
        <h2 className="home-title">Welcome to UniSlot</h2>
        <p className="home-lede">
          The timetable companion for COMSATS University Islamabad, Attock Campus. Check which rooms
          and teachers are free right now, and open any faculty or batch timetable — no login
          required.
        </p>
        <div className="home-cta">
          <Link href="/rooms" className="btn primary">
            Find a free room
          </Link>
          <Link href="/batch-timetable" className="btn">
            Browse timetables
          </Link>
        </div>
      </section>

      <div className="home-cards">
        {TOOLS.map((tool) => (
          <Link key={tool.href} href={tool.href} className="home-card">
            <span className="home-card-tag">{tool.tag}</span>
            <h3>{tool.title}</h3>
            <p>{tool.desc}</p>
            <span className="home-card-go">Open →</span>
          </Link>
        ))}
      </div>

      <div className="home-admin">
        <div>
          <h3>Administration</h3>
          <p>Manage programs, batches, subjects, teachers, rooms and periods.</p>
        </div>
        <Link href="/admin" className="btn primary">
          Admin Panel
        </Link>
      </div>
    </main>
  );
}
