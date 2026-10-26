"use client";

import { useEffect, useMemo, useState } from "react";
import {
  REVIEW_SIZE,
  answerQuizQuestion,
  answerReview,
  dayScore,
  displayStreak,
  quizAttempt,
  reviewQuestion,
  selectReview,
  setStep,
  startReview,
} from "@/lib/ledger";
import type { AppState, Domain, GenerationMeta, Lesson, Question } from "@/lib/schema";
import { costUsd } from "@/lib/pricing";
import { ModeBadge, SourceChip } from "./bits";

type Step =
  | { kind: "intro" }
  | { kind: "news"; domain: Domain }
  | { kind: "concept"; domain: Domain }
  | { kind: "example"; domain: Domain }
  | { kind: "quiz"; domain: Domain; index: number }
  | { kind: "review-intro" }
  | { kind: "review"; index: number }
  | { kind: "done" };

const DOMAIN_LABEL: Record<Domain, string> = { finance: "Finance", energy: "Climate + energy" };

function buildSteps(state: AppState, date: string, lesson: Lesson): Step[] {
  const steps: Step[] = [{ kind: "intro" }];
  for (const domain of ["finance", "energy"] as const) {
    steps.push({ kind: "news", domain }, { kind: "concept", domain }, { kind: "example", domain });
    lesson[domain].quiz.questions.forEach((_, index) => steps.push({ kind: "quiz", domain, index }));
  }
  const day = state.days[date];
  const reviewCount = day.review ? day.review.length : Math.min(REVIEW_SIZE, selectReview(state, date).length);
  if (reviewCount > 0) {
    steps.push({ kind: "review-intro" });
    for (let i = 0; i < reviewCount; i++) steps.push({ kind: "review", index: i });
  }
  steps.push({ kind: "done" });
  return steps;
}

export default function LessonPlayer({
  state,
  date,
  update,
  onExit,
}: {
  state: AppState;
  date: string;
  update: (fn: (s: AppState) => AppState) => void;
  onExit: () => void;
}) {
  const lesson = state.lessons[date];
  const day = state.days[date];
  const steps = useMemo(() => buildSteps(state, date, lesson), [state, date, lesson]);
  const stepIndex = Math.min(day.step, steps.length - 1);
  const step = steps[stepIndex];

  // Freeze the review set as soon as the learner reaches it.
  const reachedReview = step.kind === "review-intro" || step.kind === "review" || step.kind === "done";
  useEffect(() => {
    if (reachedReview && !day.review) update((s) => startReview(s, date));
  }, [reachedReview, day.review, date, update]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stepIndex]);

  const go = (i: number) => update((s) => setStep(s, date, Math.max(0, Math.min(i, steps.length - 1))));
  const next = () => go(stepIndex + 1);
  const back = () => (stepIndex === 0 ? onExit() : go(stepIndex - 1));

  const answered = (() => {
    if (step.kind === "quiz") {
      const q = lesson[step.domain].quiz.questions[step.index];
      return q.id in (quizAttempt(state, date, step.domain)?.responses ?? {});
    }
    if (step.kind === "review") return day.review?.[step.index]?.response !== undefined;
    return true;
  })();

  const section =
    step.kind === "news" || step.kind === "concept" || step.kind === "example" || step.kind === "quiz"
      ? step.domain
      : step.kind === "review-intro" || step.kind === "review"
        ? "review"
        : null;

  return (
    <main className="shell">
      <div className="lesson-top">
        <button className="icon-btn" aria-label="Back" onClick={back}>
          ‹
        </button>
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={stepIndex}
          aria-valuemin={0}
          aria-valuemax={steps.length - 1}
        >
          <span style={{ width: `${(stepIndex / (steps.length - 1)) * 100}%` }} />
        </div>
        <button className="icon-btn" aria-label="Close lesson" onClick={onExit}>
          ×
        </button>
      </div>

      {section && (
        <div className={`section-label ${section}`}>
          {section === "review" ? "Review · from your ledger" : DOMAIN_LABEL[section]}
          {step.kind === "quiz" && ` · Question ${step.index + 1} of ${lesson[step.domain].quiz.questions.length}`}
          {step.kind === "review" && day.review && ` · ${step.index + 1} of ${day.review.length}`}
        </div>
      )}

      <div className="step" key={stepIndex}>
        <div className="step-body">
          <StepBody step={step} state={state} date={date} lesson={lesson} update={update} />
        </div>

        {step.kind !== "quiz" && step.kind !== "review" && step.kind !== "done" && (
          <div className="step-actions">
            <button className={`btn ${section ? `btn-${section}` : ""}`} onClick={next}>
              {step.kind === "intro" ? "Let’s go" : step.kind === "example" ? "Quiz me" : "Continue"}
            </button>
          </div>
        )}
        {(step.kind === "quiz" || step.kind === "review") && answered && (
          <div className="step-actions">
            <button className="btn" onClick={next}>
              Continue
            </button>
          </div>
        )}
        {step.kind === "done" && (
          <div className="step-actions">
            <button className="btn" onClick={onExit}>
              Back to home
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function StepBody({
  step,
  state,
  date,
  lesson,
  update,
}: {
  step: Step;
  state: AppState;
  date: string;
  lesson: Lesson;
  update: (fn: (s: AppState) => AppState) => void;
}) {
  const sourceById = (id: string) => lesson.sources.find((s) => s.id === id);

  switch (step.kind) {
    case "intro":
      return (
        <>
          <div className="meta-row" style={{ marginTop: 8 }}>
            <ModeBadge lesson={lesson} />
          </div>
          <h2 style={{ marginTop: 14 }}>{lesson.title}</h2>
          <p>{lesson.intro}</p>
          <div className="callout finance" style={{ marginBottom: 10 }}>
            <span className="callout-label">Finance</span>
            {lesson.finance.concept.conceptName} · {lesson.finance.quiz.questions.length} questions
          </div>
          <div className="callout energy" style={{ marginBottom: 10 }}>
            <span className="callout-label">Climate + energy</span>
            {lesson.energy.concept.conceptName} · {lesson.energy.quiz.questions.length} questions
          </div>
          <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 14 }}>
            About {lesson.estimatedMinutes} minutes. Concepts count as earned only once you finish their quiz.
          </p>
          {lesson.generation && <Provenance g={lesson.generation} cited={lesson.sources.length} />}
        </>
      );

    case "news":
      return (
        <>
          <h2>What happened</h2>
          {lesson[step.domain].news.map((item, i) => (
            <article className="news-item" key={i}>
              <h3>{item.headline}</h3>
              <p className="fact">{item.fact}</p>
              <p className="sowhat">
                <b>Why it matters</b>
                {item.soWhat}
              </p>
              {item.sourceIds.map((id) => {
                const src = sourceById(id);
                return src ? <SourceChip key={id} source={src} /> : null;
              })}
            </article>
          ))}
        </>
      );

    case "concept": {
      const c = lesson[step.domain].concept;
      return (
        <>
          <h2>{c.conceptName}</h2>
          <p className="hook">{c.hook}</p>
          <div className={`callout ${step.domain}`}>
            <span className="callout-label">The intuition</span>
            {c.intuition}
          </div>
        </>
      );
    }

    case "example": {
      const c = lesson[step.domain].concept;
      return (
        <>
          <h2>See it in action</h2>
          <div className={`callout ${step.domain}`}>
            <span className="callout-label">Worked example</span>
            {c.example}
          </div>
        </>
      );
    }

    case "quiz": {
      const q = lesson[step.domain].quiz.questions[step.index];
      const attempt = quizAttempt(state, date, step.domain);
      return (
        <QuestionCard
          key={q.id}
          question={q}
          response={attempt?.responses[q.id]}
          onSubmit={(choice) => update((s) => answerQuizQuestion(s, date, step.domain, q.id, choice))}
        />
      );
    }

    case "review-intro":
      return (
        <>
          <h2>Quick review</h2>
          <p>
            {state.days[date].review?.length ?? REVIEW_SIZE} questions on concepts you’ve already earned — spaced out
            so they stick.
          </p>
          <div className="callout" style={{ background: "var(--review-soft)" }}>
            <span className="callout-label">Why these?</span>
            Review only ever pulls from your earned ledger. Today’s new concepts join the rotation tomorrow.
          </div>
        </>
      );

    case "review": {
      const item = state.days[date].review?.[step.index];
      if (!item) return <p>Preparing your review…</p>;
      const q = reviewQuestion(state, item.conceptId, item.questionId);
      if (!q) return <p>This review question is unavailable.</p>;
      return (
        <>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 4px" }}>{state.ledger[item.conceptId]?.name}</p>
          <QuestionCard
            key={q.id}
            question={q}
            response={item.response}
            onSubmit={(choice) => update((s) => answerReview(s, date, q.id, choice))}
          />
        </>
      );
    }

    case "done":
      return <DoneCard state={state} date={date} lesson={lesson} />;
  }
}

function QuestionCard({
  question,
  response,
  onSubmit,
}: {
  question: Question;
  response: number | undefined;
  onSubmit: (choice: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const locked = response !== undefined;
  const correct = locked && response === question.answerIndex;

  return (
    <>
      <p className="question">{question.prompt}</p>
      <div className="choices" role="radiogroup">
        {question.choices.map((choice, i) => {
          let cls = "choice";
          if (locked) {
            if (i === question.answerIndex) cls += " correct";
            else if (i === response) cls += " wrong";
            else cls += " dim";
          } else if (selected === i) cls += " selected";
          return (
            <button
              key={i}
              className={cls}
              role="radio"
              aria-checked={locked ? response === i : selected === i}
              disabled={locked}
              onClick={() => setSelected(i)}
            >
              <span className="letter">{String.fromCharCode(65 + i)}</span>
              <span>{choice}</span>
            </button>
          );
        })}
      </div>

      {locked ? (
        <div className={`feedback ${correct ? "good" : "bad"}`} role="status">
          <strong>{correct ? "Correct" : `Not quite — the answer is ${String.fromCharCode(65 + question.answerIndex)}`}</strong>
          {question.explanation}
        </div>
      ) : (
        <div className="step-actions">
          <button className="btn" disabled={selected === null} onClick={() => selected !== null && onSubmit(selected)}>
            Check answer
          </button>
        </div>
      )}
    </>
  );
}

function DoneCard({ state, date, lesson }: { state: AppState; date: string; lesson: Lesson }) {
  const day = state.days[date];
  const { correct, total } = dayScore(state, date);

  if (!day.completedAt) {
    const missing = [
      !day.financeComplete && "the finance quiz",
      !day.energyComplete && "the energy quiz",
      !day.reviewComplete && "the review",
    ].filter(Boolean);
    return (
      <div className="complete">
        <h2>Almost there</h2>
        <p>Finish {missing.join(" and ")} to complete today and keep your streak.</p>
      </div>
    );
  }

  const streak = displayStreak(state, date);
  return (
    <div className="complete">
      <div className="big-flame">🔥</div>
      <h2>Day complete</h2>
      <p>
        {correct} of {total} correct. {streak > 1 ? `That’s ${streak} days in a row.` : "Streak started — come back tomorrow."}
      </p>
      <div className="reward-row">
        <div className="stat">
          <span className="stat-value">+{day.awardedXp}</span>
          <span className="stat-label">XP</span>
        </div>
        <div className="stat">
          <span className="stat-value">🔥 {streak}</span>
          <span className="stat-label">day streak</span>
        </div>
        <div className="stat">
          <span className="stat-value">{Object.keys(state.ledger).length}</span>
          <span className="stat-label">earned</span>
        </div>
      </div>
      <div className="earned-list">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Added to your ledger
        </div>
        {(["finance", "energy"] as const).map((d) => {
          const id = lesson[d].concept.conceptId;
          const entry = state.ledger[id];
          return entry ? (
            <div className="earned-chip" key={id}>
              <span>{entry.name}</span>
              <span className={`status status-${entry.status}`}>{entry.status}</span>
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

function Provenance({ g, cited }: { g: GenerationMeta; cited: number }) {
  const n = (v: number | null) => (v === null ? "n/a" : v.toLocaleString());
  const replayed = g.gatewayCache?.toUpperCase() === "HIT";
  const tokens = `${n(g.usage.inputTokens)} in${g.usage.cachedInputTokens ? ` (${n(g.usage.cachedInputTokens)} cached)` : ""} · ${n(g.usage.outputTokens)} out`;
  const c = costUsd(g.usage);
  return (
    <div className="provenance">
      <b>How this lesson was made:</b> {g.model} read {g.sourcesConsidered} items from {g.feedsOk}/{g.feedsTotal} public feeds, cited {cited}
      {g.quarantined ? `, screened out ${g.quarantined} suspicious item${g.quarantined > 1 ? "s" : ""}` : ""}
      {g.attempts > 1 ? ` (${g.attempts} attempts)` : ""}.{" "}
      {replayed
        ? `Identical request already answered today, so the AI gateway replayed it in ${(g.latencyMs / 1000).toFixed(0)}s with no new model call (the original generation used ${tokens}).`
        : `Generated in ${(g.latencyMs / 1000).toFixed(0)}s. Tokens: ${tokens}${c === null ? "" : ` ≈ $${c.toFixed(4)} at list price`}.`}
    </div>
  );
}
