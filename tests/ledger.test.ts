import { describe, expect, it } from "vitest";
import demo from "@/fixtures/demo-lesson.json";
import { EARNED_SEED, PENDING_SEED, REVIEW_BANK } from "@/lib/concepts";
import {
  XP_DAY_BONUS,
  XP_PER_CORRECT,
  addDays,
  answerQuizQuestion,
  answerReview,
  displayStreak,
  ensureDay,
  initialState,
  isEarned,
  quizAttempt,
  reviewQuestion,
  selectReview,
  startReview,
} from "@/lib/ledger";
import { parseState } from "@/lib/storage";
import { LessonSchema, type AppState, type Domain, type Lesson } from "@/lib/schema";

const lesson: Lesson = LessonSchema.parse(demo);
const D = "2026-10-26";
const NOW = new Date("2026-10-26T12:00:00Z");
const FIN = lesson.finance.concept.conceptId;
const EN = lesson.energy.concept.conceptId;

function answerAll(s: AppState, domain: Domain, date = D, correct = true): AppState {
  for (const q of lesson[domain].quiz.questions) {
    const choice = correct ? q.answerIndex : (q.answerIndex + 1) % q.choices.length;
    s = answerQuizQuestion(s, date, domain, q.id, choice, NOW);
  }
  return s;
}

function doReview(s: AppState, date = D, correct = true): AppState {
  s = startReview(s, date);
  for (const r of s.days[date].review ?? []) {
    const q = reviewQuestion(s, r.conceptId, r.questionId)!;
    s = answerReview(s, date, r.questionId, correct ? q.answerIndex : (q.answerIndex + 1) % q.choices.length, NOW);
  }
  return s;
}

function completeDay(s: AppState, date: string, l: Lesson = lesson): AppState {
  s = ensureDay(s, date, l);
  s = answerAll(s, "finance", date);
  s = answerAll(s, "energy", date);
  return doReview(s, date);
}

describe("seed state", () => {
  it("seeds earned concepts as knowledge only — no XP, streak, dates or attempts", () => {
    const s = initialState();
    expect(Object.keys(s.ledger)).toHaveLength(EARNED_SEED.length);
    for (const e of Object.values(s.ledger)) {
      expect(e.status).toBe("Comfortable");
      expect(e.earnedAt).toBeUndefined();
      expect(e.nextReviewAt).toBeUndefined();
      expect(e.origin).toBe("seed");
    }
    expect(s.xp).toBe(0);
    expect(s.streak).toEqual({ current: 0, longest: 0 });
    expect(s.attempts).toEqual({});
  });

  it("never seeds delivered-but-unanswered concepts as earned", () => {
    const s = initialState();
    for (const p of PENDING_SEED) expect(isEarned(s, p.conceptId)).toBe(false);
    expect(s.pending.map((p) => p.conceptId)).toContain("virtual-power-plants");
  });

  it("has a review question for every seeded earned concept", () => {
    for (const e of EARNED_SEED) expect(REVIEW_BANK[e.conceptId]?.length).toBeGreaterThan(0);
  });
});

describe("earning invariant", () => {
  it("opening/delivering a lesson earns nothing and awards nothing", () => {
    const s = ensureDay(initialState(), D, lesson);
    expect(isEarned(s, FIN)).toBe(false);
    expect(isEarned(s, EN)).toBe(false);
    expect(s.pending.map((p) => p.conceptId)).toContain(FIN);
    expect(s.xp).toBe(0);
    expect(s.days[D].completedAt).toBeUndefined();
  });

  it("a partially answered quiz does not earn the concept", () => {
    let s = ensureDay(initialState(), D, lesson);
    const [q1, q2] = lesson.finance.quiz.questions;
    s = answerQuizQuestion(s, D, "finance", q1.id, q1.answerIndex, NOW);
    s = answerQuizQuestion(s, D, "finance", q2.id, q2.answerIndex, NOW);
    expect(isEarned(s, FIN)).toBe(false);
    expect(s.days[D].financeComplete).toBe(false);
    expect(quizAttempt(s, D, "finance")?.complete).toBe(false);
  });

  it("completing one domain quiz earns only that domain's concept", () => {
    let s = ensureDay(initialState(), D, lesson);
    s = answerAll(s, "finance");
    expect(isEarned(s, FIN)).toBe(true);
    expect(isEarned(s, EN)).toBe(false);
    expect(s.pending.map((p) => p.conceptId)).not.toContain(FIN);
    expect(s.pending.map((p) => p.conceptId)).toContain(EN);
    expect(s.xp).toBe(0);
    expect(s.streak.current).toBe(0);
  });

  it("completing with wrong answers still earns (as New) — completion, not luck, is the gate", () => {
    let s = ensureDay(initialState(), D, lesson);
    s = answerAll(s, "energy", D, false);
    expect(s.ledger[EN].status).toBe("New");
    expect(s.ledger[EN].nextReviewAt).toBe(addDays(D, 1));
  });

  it("answers lock: a second answer to the same question is ignored", () => {
    let s = ensureDay(initialState(), D, lesson);
    const q = lesson.finance.quiz.questions[0];
    const wrong = (q.answerIndex + 1) % q.choices.length;
    s = answerQuizQuestion(s, D, "finance", q.id, wrong, NOW);
    const s2 = answerQuizQuestion(s, D, "finance", q.id, q.answerIndex, NOW);
    expect(s2).toBe(s);
    expect(quizAttempt(s2, D, "finance")?.correct[q.id]).toBe(false);
  });

  it("grades deterministically from the answer key", () => {
    let s = ensureDay(initialState(), D, lesson);
    const q = lesson.energy.quiz.questions[2];
    s = answerQuizQuestion(s, D, "energy", q.id, q.answerIndex, NOW);
    expect(quizAttempt(s, D, "energy")?.correct[q.id]).toBe(true);
  });

  it("rejects questions not in today's quiz and out-of-range choices", () => {
    const s = ensureDay(initialState(), D, lesson);
    expect(() => answerQuizQuestion(s, D, "finance", "vpp-q1", 0, NOW)).toThrow();
    expect(() => answerQuizQuestion(s, D, "finance", "dscr-q1", 9, NOW)).toThrow();
  });
});

describe("review", () => {
  it("draws only from earned concepts", () => {
    const s = ensureDay(initialState(), D, lesson);
    const picks = selectReview(s, D, 50);
    expect(picks.length).toBeGreaterThan(0);
    for (const p of picks) expect(isEarned(s, p.conceptId)).toBe(true);
    const pendingIds = new Set(s.pending.map((p) => p.conceptId));
    for (const p of picks) expect(pendingIds.has(p.conceptId)).toBe(false);
  });

  it("does not review concepts taught today", () => {
    let s = ensureDay(initialState(), D, lesson);
    s = answerAll(s, "finance");
    s = answerAll(s, "energy");
    const picks = selectReview(s, D, 50).map((p) => p.conceptId);
    expect(picks).not.toContain(FIN);
    expect(picks).not.toContain(EN);
  });

  it("freezes the review set so refresh/re-entry does not reshuffle", () => {
    let s = ensureDay(initialState(), D, lesson);
    s = startReview(s, D);
    const first = s.days[D].review;
    expect(startReview(s, D).days[D].review).toEqual(first);
    expect(first).toHaveLength(3);
  });

  it("with an empty ledger, review is not required", () => {
    let s = initialState();
    s.ledger = {};
    s = ensureDay(s, D, lesson);
    s = startReview(s, D);
    expect(s.days[D].review).toEqual([]);
    expect(s.days[D].reviewComplete).toBe(true);
  });
});

describe("day completion, XP and streak", () => {
  it("waits for finance + energy + review before awarding anything", () => {
    let s = ensureDay(initialState(), D, lesson);
    s = answerAll(s, "finance");
    s = answerAll(s, "energy");
    expect(s.days[D].completedAt).toBeUndefined();
    expect(s.xp).toBe(0);
    s = doReview(s);
    expect(s.days[D].completedAt).toBeDefined();
    expect(s.streak.current).toBe(1);
    expect(s.xp).toBe(9 * XP_PER_CORRECT + XP_DAY_BONUS);
  });

  it("credits XP and streak exactly once", () => {
    let s = completeDay(initialState(), D);
    const xp = s.xp;
    s = completeDay(s, D); // replaying every action is a no-op
    s = doReview(s);
    expect(s.xp).toBe(xp);
    expect(s.streak.current).toBe(1);
  });

  it("increments on consecutive days and resets after a gap", () => {
    let s = completeDay(initialState(), D);
    s = completeDay(s, addDays(D, 1));
    expect(s.streak.current).toBe(2);
    expect(displayStreak(s, addDays(D, 2))).toBe(2); // not broken until a full day is missed
    expect(displayStreak(s, addDays(D, 3))).toBe(0);
    s = completeDay(s, addDays(D, 4));
    expect(s.streak.current).toBe(1);
    expect(s.streak.longest).toBe(2);
  });

  it("a reused fixture on a new day starts fresh (attempts are day-scoped)", () => {
    let s = completeDay(initialState(), D);
    const next = addDays(D, 1);
    s = ensureDay(s, next, lesson);
    expect(quizAttempt(s, next, "finance")).toBeUndefined();
    expect(s.days[next].financeComplete).toBe(false);
  });
});

describe("persistence", () => {
  it("round-trips through JSON and keeps answers", () => {
    let s = ensureDay(initialState(), D, lesson);
    const q = lesson.finance.quiz.questions[0];
    s = answerQuizQuestion(s, D, "finance", q.id, q.answerIndex, NOW);
    const { state, recovered } = parseState(JSON.stringify(s));
    expect(recovered).toBe(false);
    expect(state).toEqual(s);
  });

  it("does not replace a cached lesson on refresh", () => {
    let s = ensureDay(initialState(), D, lesson);
    const other = { ...lesson, id: "other-lesson", title: "Different" };
    s = ensureDay(s, D, other);
    expect(s.lessons[D].id).toBe(lesson.id);
  });

  it("recovers safely from corrupt or tampered storage", () => {
    expect(parseState("{not json").recovered).toBe(true);
    const tampered = { ...initialState(), xp: -5 };
    expect(parseState(JSON.stringify(tampered)).recovered).toBe(true);
  });
});

describe("in-app review bank", () => {
  it("unlocks a concept's held-back review question only when the concept is earned", () => {
    let s = ensureDay(initialState(), D, lesson);
    expect(s.reviewBank[FIN]).toBeUndefined();
    s = answerAll(s, "finance");
    expect(s.reviewBank[FIN]?.map((x) => x.id)).toEqual([lesson.finance.reviewQuestion.id]);
    expect(s.reviewBank[EN]).toBeUndefined();
  });

  it("earned-in-app concepts become reviewable on later days", () => {
    let s = initialState();
    s.ledger = {}; // isolate: only in-app concepts
    s = completeDay(s, D);
    const later = addDays(D, 5);
    s = ensureDay(s, later, { ...lesson, id: "another-lesson", finance: { ...lesson.finance, concept: { ...lesson.finance.concept, conceptId: "x-new-fin" }, quiz: { ...lesson.finance.quiz, conceptId: "x-new-fin" } }, energy: { ...lesson.energy, concept: { ...lesson.energy.concept, conceptId: "x-new-en" }, quiz: { ...lesson.energy.quiz, conceptId: "x-new-en" } } });
    const picks = selectReview(s, later).map((p) => p.conceptId).sort();
    expect(picks).toEqual([EN, FIN].sort());
  });
});

describe("migration", () => {
  it("upgrades a v1 save (sample lesson cached, progress made) without losing progress", () => {
    let s = completeDay(initialState(), D);
    const v1 = JSON.parse(JSON.stringify(s));
    v1.schemaVersion = 1;
    delete v1.reviewBank;
    for (const l of Object.values(v1.lessons) as { finance: Record<string, unknown>; energy: Record<string, unknown> }[]) {
      delete l.finance.reviewQuestion;
      delete l.energy.reviewQuestion;
    }
    const { state, recovered } = parseState(JSON.stringify(v1));
    expect(recovered).toBe(false);
    expect(state.schemaVersion).toBe(2);
    expect(state.xp).toBe(s.xp);
    expect(state.streak).toEqual(s.streak);
    expect(state.reviewBank).toEqual({});
  });
});
