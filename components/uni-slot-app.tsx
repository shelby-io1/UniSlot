"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type MetaPeriod = {
  id: number;
  label: string;
  sortOrder: number;
  startMinutes: number;
  endMinutes: number;
  displayStart: string;
  displayEnd: string;
};
type MetaRoom = { id: number; name: string; group: string };
type MetaTeacher = { id: number; name: string };
type MetaBatch = { id: number; label: string; program: string; semesterNumber: number };
type Meta = {
  term: { id: number; name: string; startsOn: string | null; isActive: boolean } | null;
  days: string[];
  periods: MetaPeriod[];
  rooms: MetaRoom[];
  teachers: MetaTeacher[];
  batches: MetaBatch[];
  subjects: { id: number; title: string }[];
};

type BusyRoom = { room: MetaRoom; entries: { batchLabel: string; teacherName: string | null }[] };
type BusyTeacher = { teacher: MetaTeacher; entries: { batchLabel: string; roomName: string | null }[] };
type FreeResult = {
  dayIndex: number;
  slot: number;
  kind: "rooms" | "teachers";
  freeRooms?: MetaRoom[];
  busyRooms?: BusyRoom[];
  freeTeachers?: MetaTeacher[];
  busyTeachers?: BusyTeacher[];
};

type Block = {
  startSlot: number;
  endSlot: number;
  batchLabel: string;
  roomName: string | null;
  teacherName: string | null;
  subjectTitle: string;
  isRepeater: boolean;
};
type TimetableResult = { mode: "batch" | "teacher"; days: { dayIndex: number; blocks: Block[] }[] };

const ROOM_GROUPS = ["Lecture halls", "Classrooms", "Lecture theatres", "Labs"];

export const VIEWS = [
  { key: "rooms", href: "/rooms", label: "Free Rooms Now" },
  { key: "faculty", href: "/faculty", label: "Free Faculty Now" },
  { key: "teacher", href: "/teacher-timetable", label: "Faculty Timetable" },
  { key: "batch", href: "/batch-timetable", label: "Batchwise Timetable" },
] as const;

export type UniSlotView = (typeof VIEWS)[number]["key"];

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export default function UniSlotApp({ view }: { view: UniSlotView }) {
  const tab = VIEWS.findIndex((v) => v.key === view);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState(0);
  const [cur, setCur] = useState(0);
  const [today, setToday] = useState(-1);
  const [q, setQ] = useState("");
  const [bsel, setBsel] = useState(0);
  const [tsel, setTsel] = useState(0);
  const [free, setFree] = useState<FreeResult | null>(null);
  const [timetable, setTimetable] = useState<TimetableResult | null>(null);

  const loadMeta = useCallback(() => {
    return fetch("/api/meta", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Unable to reach the server"))))
      .then((data: Meta) => {
        setMeta(data);
        const now = new Date();
        const weekday = now.getDay();
        const minutes = now.getHours() * 60 + now.getMinutes();
        let activeDay = 0;
        let activeSlot = 0;
        let todayIndex = -1;
        if (weekday >= 1 && weekday <= 5) {
          todayIndex = weekday - 1;
          activeDay = todayIndex;
          const idx = data.periods.findIndex((p) => minutes < p.endMinutes);
          activeSlot = idx < 0 ? Math.max(0, data.periods.length - 1) : idx;
        }
        setToday(todayIndex);
        setDay(activeDay);
        setSlot(activeSlot);
        setCur(activeSlot);

        const storedBatch = lsGet("unislot_batch");
        const storedTeacher = lsGet("unislot_teacher");
        if (storedBatch !== null) {
          const v = Number(storedBatch);
          if (data.batches.some((b) => b.id === v)) setBsel(v);
        }
        if (storedTeacher !== null) {
          const v = Number(storedTeacher);
          if (data.teachers.some((t) => t.id === v)) setTsel(v);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to reach the server");
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMeta().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [loadMeta]);

  useEffect(() => {
    if (!meta || tab > 1) return;
    let cancelled = false;
    fetch(`/api/free?kind=${tab === 0 ? "rooms" : "teachers"}&day=${day}&period=${slot}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load availability"))))
      .then((data: FreeResult) => {
        if (!cancelled) setFree(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Request failed");
      });
    return () => {
      cancelled = true;
    };
  }, [meta, tab, day, slot]);

  useEffect(() => {
    if (!meta || tab < 2) return;
    let cancelled = false;
    const url = tab === 2 ? `/api/timetable?teacher=${tsel}` : `/api/timetable?batch=${bsel}`;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load timetable"))))
      .then((data: TimetableResult) => {
        if (!cancelled) setTimetable(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Request failed");
      });
    return () => {
      cancelled = true;
    };
  }, [meta, tab, tsel, bsel]);

  function backToNow() {
    setDay(today < 0 ? 0 : today);
    setSlot(cur);
  }

  if (error) {
    return (
      <main>
        <div className="note" style={{ marginTop: 14 }}>
          {error}
        </div>
      </main>
    );
  }

  return (
    <main>
      <h2 className="page-title">{VIEWS[tab].label}</h2>
      <div className="panel">
          {!meta && <div className="empty">Loading…</div>}
          {meta && tab < 2 && (
            <FreePanel
              kind={tab === 0 ? "rooms" : "teachers"}
              meta={meta}
              result={free}
              day={day}
              slot={slot}
              today={today}
              cur={cur}
              q={q}
              onQ={setQ}
              onDay={setDay}
              onSlot={setSlot}
              onNow={backToNow}
            />
          )}
          {meta && tab >= 2 && (
            <TimetablePanel
              mode={tab === 2 ? "teacher" : "batch"}
              meta={meta}
              result={timetable}
              today={today}
              bsel={bsel}
              tsel={tsel}
              onBatch={(v) => {
                setBsel(v);
                lsSet("unislot_batch", String(v));
              }}
              onTeacher={(v) => {
                setTsel(v);
                lsSet("unislot_teacher", String(v));
              }}
            />
          )}
      </div>
    </main>
  );
}

function Chips({
  items,
  active,
  onClick,
}: {
  items: { label: string; sub?: string }[];
  active: number;
  onClick: (i: number) => void;
}) {
  return (
    <div className="row">
      {items.map((item, i) => (
        <button key={i} type="button" className={`chip${i === active ? " on" : ""}`} onClick={() => onClick(i)}>
          {item.label}
          {item.sub ? <small>{item.sub}</small> : null}
        </button>
      ))}
    </div>
  );
}

function FreePanel({
  kind,
  meta,
  result,
  day,
  slot,
  today,
  cur,
  q,
  onQ,
  onDay,
  onSlot,
  onNow,
}: {
  kind: "rooms" | "teachers";
  meta: Meta;
  result: FreeResult | null;
  day: number;
  slot: number;
  today: number;
  cur: number;
  q: string;
  onQ: (v: string) => void;
  onDay: (d: number) => void;
  onSlot: (s: number) => void;
  onNow: () => void;
}) {
  const query = q.trim().toLowerCase();
  const isNow = day === today && slot === cur;
  const period = meta.periods[slot];

  return (
    <>
      <Chips items={meta.days.map((d) => ({ label: d.slice(0, 3) }))} active={day} onClick={onDay} />
      <Chips
        items={meta.periods.map((p, i) => ({
          label: `L${i + 1}`,
          sub: `${p.displayStart}–${p.displayEnd}`,
        }))}
        active={slot}
        onClick={onSlot}
      />
      <div className="note">
        {isNow ? "Showing right now: " : "Showing: "}
        {meta.days[day]}, Lecture {slot + 1} ({period?.displayStart}–{period?.displayEnd}){" "}
        {!isNow && (
          <a
            href="#"
            style={{ color: "inherit", fontWeight: 700 }}
            onClick={(e) => {
              e.preventDefault();
              onNow();
            }}
          >
            Back to now
          </a>
        )}
      </div>
      <input
        type="search"
        placeholder={kind === "rooms" ? "Search room…" : "Search faculty…"}
        value={q}
        onChange={(e) => onQ(e.target.value)}
      />
      {!result ? (
        <div className="empty">Loading…</div>
      ) : kind === "rooms" ? (
        <RoomsResult result={result} query={query} />
      ) : (
        <TeachersResult result={result} query={query} />
      )}
      <p className="foot">
        Only rooms and teachers that appear in the timetable are listed. Extra or make-up classes
        are not included, so please confirm before you go.
      </p>
    </>
  );
}

function RoomsResult({ result, query }: { result: FreeResult; query: string }) {
  const freeRooms = (result.freeRooms ?? []).filter((r) => r.name.toLowerCase().includes(query));
  const busyRooms = (result.busyRooms ?? []).filter((b) => b.room.name.toLowerCase().includes(query));

  return (
    <>
      {result.busyRooms && result.busyRooms.length === 0 && result.dayIndex === 2 && result.slot === 1 && (
        <div className="note">
          Wednesday 10:00–11:30 is the AS slot, so no regular classes are scheduled and everything
          shows as free.
        </div>
      )}
      <h2>{freeRooms.length} rooms free</h2>
      {ROOM_GROUPS.map((group) => {
        const list = freeRooms.filter((r) => r.group === group);
        if (!list.length) return null;
        return (
          <div key={group}>
            <h2>{group}</h2>
            <div className="grid">
              {list.map((r) => (
                <span key={r.id} className="free">
                  {r.name}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <h2>{busyRooms.length} rooms busy</h2>
      <div className="list">
        {busyRooms.map((b) => (
          <div key={b.room.id}>
            <span className="busy">{b.room.name}</span>
            <span className="m">
              {b.entries
                .map((e) => e.batchLabel + (e.teacherName ? " · " + e.teacherName : ""))
                .join(" | ")}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function TeachersResult({ result, query }: { result: FreeResult; query: string }) {
  const freeTeachers = (result.freeTeachers ?? []).filter((t) => t.name.toLowerCase().includes(query));
  const busyTeachers = (result.busyTeachers ?? []).filter((b) =>
    b.teacher.name.toLowerCase().includes(query),
  );

  return (
    <>
      <h2>{freeTeachers.length} faculty free</h2>
      <div className="list">
        {freeTeachers.map((t) => (
          <div key={t.id}>
            <span>{t.name}</span>
            <span className="m" style={{ color: "var(--ok)" }}>
              Free
            </span>
          </div>
        ))}
      </div>
      <h2>{busyTeachers.length} faculty busy</h2>
      <div className="list">
        {busyTeachers.map((b) => (
          <div key={b.teacher.id}>
            <span className="busy">{b.teacher.name}</span>
            <span className="m">
              {b.entries
                .map((e) => e.batchLabel + (e.roomName ? " · " + e.roomName : ""))
                .join(" | ")}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function TimetablePanel({
  mode,
  meta,
  result,
  today,
  bsel,
  tsel,
  onBatch,
  onTeacher,
}: {
  mode: "batch" | "teacher";
  meta: Meta;
  result: TimetableResult | null;
  today: number;
  bsel: number;
  tsel: number;
  onBatch: (v: number) => void;
  onTeacher: (v: number) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, MetaBatch[]>();
    for (const b of meta.batches) {
      const list = map.get(b.program) ?? [];
      list.push(b);
      map.set(b.program, list);
    }
    return [...map.entries()];
  }, [meta.batches]);

  return (
    <>
      {mode === "batch" ? (
        <select value={bsel} onChange={(e) => onBatch(Number(e.target.value))}>
          {grouped.map(([program, list]) => (
            <optgroup key={program} label={program}>
              {list.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <select value={tsel} onChange={(e) => onTeacher(Number(e.target.value))}>
          {meta.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {!result ? (
        <div className="empty">Loading…</div>
      ) : (
        <WeekGrid mode={mode} meta={meta} result={result} today={today} />
      )}
    </>
  );
}

function WeekGrid({
  mode,
  meta,
  result,
  today,
}: {
  mode: "batch" | "teacher";
  meta: Meta;
  result: TimetableResult | null;
  today: number;
}) {
  if (!result) return null;
  return (
    <div className="week-grid">
      {result.days.map((d) => (
        <div key={d.dayIndex} className={`card${d.dayIndex === today ? " today" : ""}`}>
          <h3>
            {meta.days[d.dayIndex]}
            {d.dayIndex === today ? <span>Today</span> : null}
          </h3>
          {d.blocks.length === 0 ? (
            <div className="empty">No classes</div>
          ) : (
            d.blocks.map((b, i) => {
              const start = meta.periods[b.startSlot]?.displayStart ?? "";
              const end = meta.periods[b.endSlot]?.displayEnd ?? "";
              const secondary =
                mode === "batch"
                  ? [b.teacherName, b.roomName]
                  : [b.batchLabel, b.roomName];
              return (
                <div className="it" key={i}>
                  <div className="tm">
                    <b>{start}</b>
                    {end}
                  </div>
                  <div>
                    <div className="s">
                      {b.subjectTitle}
                      {b.isRepeater ? <span className="rp">Repeater</span> : null}
                    </div>
                    <div className="m">{secondary.filter(Boolean).join(" · ")}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}
