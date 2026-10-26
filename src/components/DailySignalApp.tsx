"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import demoLesson from "@/fixtures/demo-lesson.json";
import { displayStreak, ensureDay, localDate, quizAttempt } from "@/lib/ledger";
import { LessonSchema, type AppState, type Domain, type Lesson } from "@/lib/schema";
import { loadState, resetState, saveState } from "@/lib/storage";
import LessonPlayer from "./LessonPlayer";
import LedgerView from "./LedgerView";
import { ModeBadge } from "./bits";

type View = "home" | "lesson" | "ledger";

/** Bundled, dated sample lesson — used only when the user chooses it or live mode is unavailable. */
const SAMPLE: Lesson = LessonSchema.parse(demoLesson);

type Gen = { status: "idle" | "generating" | "error" | "offline"; message?: string; startedAt?: number };

export default function DailySignalApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>("home");
  const [today, setToday] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);
  const [gen, setGen] = useState<Gen>({ status: "idle" });
  const autoStarted = useRef(false);

  useEffect(() => {
    const { state: loaded, recovered } = loadState();
    setState(loaded);
    setToday(localDate());
    if (recovered) setNotice("Saved progress couldn’t be read, so the app started fresh. A backup was kept.");
  }, []);

  /** All learner-state writes funnel through here and persist immediately. */
  const update = useCallback((fn: (s: AppState) => AppState) => {
    setState((prev) => {
      if (!prev) return prev;
      try {
        const next = fn(prev);
        if (next !== prev) saveState(next);
        return next;
      } catch (err) {
        console.error(err);
        setNotice("That action couldn’t be saved. Please try again.");
        return prev;
      }
    });
  }, []);

  /** Ask the server agent for today's lesson. The result is cached in state: one generation per day. */
  const generate = useCallback(
    async (s: AppState, date: string) => {
      setGen({ status: "generating", startedAt: Date.now() });
      try {
        const res = await fetch("/api/lesson", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            earned: Object.values(s.ledger).map(({ conceptId, name, domain }) => ({ conceptId, name, domain })),
            pending: s.pending,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setGen({ status: res.status === 503 ? "offline" : "error", message: body.message ?? `Request failed (${res.status}).` });
          return;
        }
        const lesson = LessonSchema.parse(body.lesson);
        update((st) => (st.lessons[date] ? st : ensureDay(st, date, lesson)));
        setGen({ status: "idle" });
      } catch {
        setGen({ status: "error", message: "Couldn’t reach the lesson server or read its response." });
      }
    },
    [update],
  );

  useEffect(() => {
    if (!state || !today || autoStarted.current || state.lessons[today]) return;
    autoStarted.current = true;
    if (new URLSearchParams(window.location.search).has("demo")) {
      setGen({ status: "offline", message: "Sample mode was requested with ?demo." });
      return;
    }
    void generate(state, today);
  }, [state, today, generate]);

  if (!state || !today) return <div className="skeleton">Loading…</div>;

  const start = () => {
    update((s) => (s.lessons[today] ? ensureDay(s, today, s.lessons[today]) : s));
    setView("lesson");
  };

  if (view === "lesson" && state.days[today]) {
    return <LessonPlayer state={state} date={today} update={update} onExit={() => setView("home")} />;
  }
  if (view === "ledger") {
    return <LedgerView state={state} onBack={() => setView("home")} />;
  }

  return (
    <Home
      state={state}
      today={today}
      notice={notice}
      gen={gen}
      onStart={start}
      onRetry={() => generate(state, today)}
      onSample={() => {
        update((s) => ensureDay(s, today, SAMPLE));
        setGen({ status: "idle" });
      }}
      onLedger={() => setView("ledger")}
      onReset={() => {
        if (window.confirm("Erase all progress on this device? This can’t be undone.")) {
          setState(resetState());
          setView("home");
        }
      }}
    />
  );
}

function Home({
  state,
  today,
  notice,
  gen,
  onStart,
  onRetry,
  onSample,
  onLedger,
  onReset,
}: {
  state: AppState;
  today: string;
  notice: string | null;
  gen: Gen;
  onStart: () => void;
  onRetry: () => void;
  onSample: () => void;
  onLedger: () => void;
  onReset: () => void;
}) {
  const lesson = state.lessons[today];
  const streak = displayStreak(state, today);
  const earnedCount = Object.keys(state.ledger).length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="shell">
      <div className="eyebrow">{dateLabel}</div>
      <h1 className="home-title">{greeting}.</h1>

      {notice && <div className="error-box">{notice}</div>}

      <div className="stats">
        <div className="stat">
          <span className="stat-value">
            <span className={`flame ${streak === 0 ? "cold" : ""}`}>🔥</span>
            {streak}
          </span>
          <span className="stat-label">day streak</span>
        </div>
        <div className="stat">
          <span className="stat-value">{state.xp}</span>
          <span className="stat-label">XP</span>
        </div>
        <div className="stat">
          <span className="stat-value">{earnedCount}</span>
          <span className="stat-label">earned</span>
        </div>
      </div>

      {lesson ? (
        <TodayCard state={state} today={today} lesson={lesson} onStart={onStart} />
      ) : (
        <GenerationCard gen={gen} onRetry={onRetry} onSample={onSample} />
      )}

      <button className="ledger-summary" onClick={onLedger}>
        <span>
          <strong>Knowledge ledger</strong>
          <br />
          <span className="sub">
            {earnedCount} earned · {state.pending.length} taught but not yet earned
          </span>
        </span>
        <span className="chev">›</span>
      </button>

      <p className="footnote">
        Progress is saved in this browser only and doesn’t sync across devices. ·{" "}
        <button className="link-btn" onClick={onReset}>
          Reset
        </button>
      </p>
    </main>
  );
}

function Segment({ kind, label, done, total }: { kind: string; label: string; done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  return (
    <div className={`segment ${kind}`}>
      <div className="segment-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="segment-label">
        <span>{label}</span>
        <span>{done === total && total > 0 ? "✓" : `${done}/${total}`}</span>
      </div>
    </div>
  );
}

function TodayCard({ state, today, lesson, onStart }: { state: AppState; today: string; lesson: Lesson; onStart: () => void }) {
  const day = state.days[today];
  const quizProgress = (domain: Domain) => {
    const total = lesson[domain].quiz.questions.length;
    const answered = Object.keys(quizAttempt(state, today, domain)?.responses ?? {}).length;
    return { answered, total };
  };
  const fin = quizProgress("finance");
  const en = quizProgress("energy");
  const reviewTotal = day?.review?.length ?? 3;
  const reviewDone = day?.review?.filter((r) => r.response !== undefined).length ?? 0;
  const done = Boolean(day?.completedAt);
  const started = Boolean(day && (day.step > 0 || fin.answered > 0));

  return (
    <section className="card">
      <div className="meta-row">
        <ModeBadge lesson={lesson} />
        <span>≈ {lesson.estimatedMinutes} min</span>
      </div>
      <h2 className="today-title">{lesson.title}</h2>
      <p className="today-intro">{lesson.intro}</p>

      <div className="segments" aria-label="Today’s progress">
        <Segment kind="finance" label="Finance" done={fin.answered} total={fin.total} />
        <Segment kind="energy" label="Energy" done={en.answered} total={en.total} />
        <Segment kind="review" label="Review" done={reviewDone} total={reviewTotal} />
      </div>

      {done ? (
        <>
          <div className="done-banner">
            <span style={{ fontSize: 24 }}>✓</span>
            <span>Done for today · +{day?.awardedXp} XP. See you tomorrow.</span>
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={onStart}>
            Look back at today’s lesson
          </button>
        </>
      ) : (
        <button className="btn" onClick={onStart}>
          {started ? "Continue" : "Start today’s lesson"}
        </button>
      )}
    </section>
  );
}

function GenerationCard({ gen, onRetry, onSample }: { gen: Gen; onRetry: () => void; onSample: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (gen.status !== "generating") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [gen.status]);

  if (gen.status === "error" || gen.status === "offline") {
    return (
      <section className="card">
        <h2 className="today-title" style={{ marginTop: 0 }}>
          {gen.status === "offline" ? "Live lessons are off" : "Couldn’t build today’s live lesson"}
        </h2>
        {gen.status === "error" ? <div className="error-box">{gen.message}</div> : <p className="explain">{gen.message}</p>}
        <p className="today-intro">
          You can use the bundled sample lesson instead. It’s clearly labeled and built from real news dated October 15–23, 2026.
        </p>
        {gen.status === "error" && (
          <button className="btn" onClick={onRetry} style={{ marginBottom: 10 }}>
            Try again
          </button>
        )}
        <button className={`btn ${gen.status === "error" ? "btn-secondary" : ""}`} onClick={onSample}>
          Use sample lesson
        </button>
      </section>
    );
  }

  const secs = gen.startedAt ? Math.max(0, Math.round((now - gen.startedAt) / 1000)) : 0;
  return (
    <section className="card" aria-busy="true">
      <div className="meta-row">
        <span className="badge badge-live">
          <span className="dot pulse" /> Building live · {secs}s
        </span>
      </div>
      <h2 className="today-title">Writing today’s lesson</h2>
      <ol className="gen-steps">
        <li>Reading public finance and energy news feeds</li>
        <li>Picking concepts you haven’t earned yet</li>
        <li>Writing your quiz and checking every citation</li>
      </ol>
      <p className="explain">Usually 30–60 seconds, once a day. After that it’s saved on this device.</p>
    </section>
  );
}
