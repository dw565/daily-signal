import { EARNED_SEED, PENDING_SEED, REVIEW_BANK } from "./concepts";
import {
  MASTERY_ORDER,
  type AppState,
  type DailyProgress,
  type Domain,
  type LedgerEntry,
  type Lesson,
  type Mastery,
  type Question,
} from "./schema";

/**
 * The learning ledger. Every write to mastery, XP, streak or completion goes
 * through these pure functions. Lesson content (possibly LLM-generated) is
 * read-only input here: it supplies questions and answer keys, but it cannot
 * mark anything earned — only a completed required quiz can.
 */

export const XP_PER_CORRECT = 10;
export const XP_DAY_BONUS = 30;
export const REVIEW_SIZE = 3;

const REVIEW_INTERVAL_DAYS: Record<Mastery, number> = { New: 1, Developing: 3, Comfortable: 7, Strong: 14 };

/* ------------------------------- dates ---------------------------------- */

export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/* ------------------------------- state ---------------------------------- */

export function initialState(): AppState {
  const ledger: Record<string, LedgerEntry> = {};
  for (const ref of EARNED_SEED) {
    // Knowledge state only: no invented earnedAt, attempts, XP or streak.
    ledger[ref.conceptId] = { ...ref, status: "Comfortable", origin: "seed" };
  }
  return {
    schemaVersion: 2,
    ledger,
    reviewBank: {},
    pending: PENDING_SEED.filter((p) => !ledger[p.conceptId]).map((p) => ({ ...p })),
    attempts: {},
    days: {},
    lessons: {},
    xp: 0,
    streak: { current: 0, longest: 0 },
  };
}

export const isEarned = (s: AppState, conceptId: string) => Boolean(s.ledger[conceptId]);

export const attemptKey = (date: string, quizId: string) => `${date}|${quizId}`;

/**
 * Attach today's lesson. A cached lesson for the date is never replaced, so a
 * refresh can't regenerate content or reset answers. Delivering a lesson only
 * adds its concepts to `pending` — never to the ledger.
 */
export function ensureDay(state: AppState, date: string, lesson: Lesson): AppState {
  if (state.days[date] && state.lessons[date]) return state;
  const s = structuredClone(state);
  if (!s.lessons[date]) s.lessons[date] = lesson;
  const cached = s.lessons[date];
  if (!s.days[date]) {
    s.days[date] = {
      date,
      lessonId: cached.id,
      step: 0,
      financeComplete: false,
      energyComplete: false,
      reviewComplete: false,
      awardedXp: 0,
    };
  }
  for (const domain of ["finance", "energy"] as const) {
    const concept = cached[domain].concept;
    if (!s.ledger[concept.conceptId] && !s.pending.some((p) => p.conceptId === concept.conceptId)) {
      s.pending.push({ conceptId: concept.conceptId, name: concept.conceptName, domain });
    }
  }
  // Keep the cache small: last 14 lessons.
  const dates = Object.keys(s.lessons).sort();
  for (const old of dates.slice(0, Math.max(0, dates.length - 14))) delete s.lessons[old];
  return s;
}

function requireDay(state: AppState, date: string): { day: DailyProgress; lesson: Lesson } {
  const day = state.days[date];
  const lesson = state.lessons[date];
  if (!day || !lesson) throw new Error(`No lesson started for ${date}`);
  return { day, lesson };
}

export function setStep(state: AppState, date: string, step: number): AppState {
  const { day } = requireDay(state, date);
  if (day.step === step) return state;
  const s = structuredClone(state);
  s.days[date].step = Math.max(0, Math.floor(step));
  return s;
}

/* -------------------------- domain quizzes ------------------------------ */

function promote(status: Mastery, steps: number): Mastery {
  const i = MASTERY_ORDER.indexOf(status) + steps;
  return MASTERY_ORDER[Math.min(MASTERY_ORDER.length - 1, Math.max(0, i))];
}

/**
 * Record one answer to a required quiz question. Answers lock once recorded.
 * When (and only when) every required question has a recorded answer, the quiz
 * is complete and its concept is earned.
 */
export function answerQuizQuestion(
  state: AppState,
  date: string,
  domain: Domain,
  questionId: string,
  choice: number,
  now: Date = new Date(),
): AppState {
  const { lesson } = requireDay(state, date);
  const quiz = lesson[domain].quiz;
  const question = quiz.questions.find((qq) => qq.id === questionId);
  if (!question) throw new Error(`Question ${questionId} is not in today's ${domain} quiz`);
  if (!Number.isInteger(choice) || choice < 0 || choice >= question.choices.length) {
    throw new Error(`Invalid choice ${choice} for ${questionId}`);
  }

  const key = attemptKey(date, quiz.id);
  const existing = state.attempts[key];
  if (existing && questionId in existing.responses) return state; // locked
  if (existing?.complete) return state;

  const s = structuredClone(state);
  const attempt = s.attempts[key] ?? {
    key,
    quizId: quiz.id,
    conceptId: quiz.conceptId,
    responses: {},
    correct: {},
    complete: false,
  };
  attempt.responses[questionId] = choice;
  attempt.correct[questionId] = choice === question.answerIndex;

  const allAnswered = quiz.questions.every((qq) => qq.id in attempt.responses);
  if (allAnswered) {
    attempt.complete = true;
    attempt.submittedAt = now.toISOString();
    const nCorrect = quiz.questions.filter((qq) => attempt.correct[qq.id]).length;
    earnConcept(s, lesson, domain, nCorrect, quiz.questions.length, date, now);
    if (domain === "finance") s.days[date].financeComplete = true;
    else s.days[date].energyComplete = true;
  }
  s.attempts[key] = attempt;
  return tryCompleteDay(s, date, now);
}

function earnConcept(
  s: AppState,
  lesson: Lesson,
  domain: Domain,
  nCorrect: number,
  nTotal: number,
  date: string,
  now: Date,
) {
  const concept = lesson[domain].concept;
  const prior = s.ledger[concept.conceptId];
  const perfect = nCorrect === nTotal;
  const strong = nCorrect / nTotal >= 0.66;
  let status: Mastery;
  if (prior) status = perfect ? promote(prior.status, 1) : prior.status;
  else status = perfect ? "Developing" : strong ? "Developing" : "New";
  s.ledger[concept.conceptId] = {
    conceptId: concept.conceptId,
    name: prior?.name ?? concept.conceptName,
    domain: prior?.domain ?? domain,
    status,
    earnedAt: prior?.earnedAt ?? now.toISOString(),
    nextReviewAt: addDays(date, REVIEW_INTERVAL_DAYS[status]),
    origin: prior?.origin ?? "quiz",
  };
  s.pending = s.pending.filter((p) => p.conceptId !== concept.conceptId);
  // Unlock this concept's held-back review question for future days.
  const rq = lesson[domain].reviewQuestion;
  const bank = s.reviewBank[concept.conceptId] ?? [];
  if (!REVIEW_BANK[concept.conceptId] && !bank.some((q) => q.id === rq.id)) {
    s.reviewBank[concept.conceptId] = [...bank, rq].slice(-5);
  }
}

export function quizAttempt(state: AppState, date: string, domain: Domain) {
  const lesson = state.lessons[date];
  if (!lesson) return undefined;
  return state.attempts[attemptKey(date, lesson[domain].quiz.id)];
}

/* ------------------------------ review ---------------------------------- */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Concepts eligible for spaced repetition on `date`: EARNED only, with a
 * question bank, and not earned today (spacing needs at least a day).
 */
/** Review questions for a concept: built-in bank for seeded concepts, else learned-in-app bank. */
export function questionsFor(state: AppState, conceptId: string): Question[] {
  return REVIEW_BANK[conceptId] ?? state.reviewBank[conceptId] ?? [];
}

export function reviewEligible(state: AppState, date: string): LedgerEntry[] {
  const lesson = state.lessons[date];
  const taughtToday = new Set(lesson ? [lesson.finance.concept.conceptId, lesson.energy.concept.conceptId] : []);
  return Object.values(state.ledger).filter(
    (e) =>
      questionsFor(state, e.conceptId).length > 0 &&
      !taughtToday.has(e.conceptId) &&
      !(e.earnedAt && localDate(new Date(e.earnedAt)) === date),
  );
}

export function selectReview(state: AppState, date: string, size = REVIEW_SIZE): LedgerEntry[] {
  const due = (e: LedgerEntry) => !e.nextReviewAt || e.nextReviewAt <= date;
  const sorted = reviewEligible(state, date).sort((a, b) => {
    const da = due(a) ? 0 : 1;
    const db = due(b) ? 0 : 1;
    if (da !== db) return da - db;
    const na = a.nextReviewAt ?? "";
    const nb = b.nextReviewAt ?? "";
    if (na !== nb) return na < nb ? -1 : 1;
    return hash(date + a.conceptId) - hash(date + b.conceptId);
  });
  // Interleave domains so a review isn't all one subject.
  const fin = sorted.filter((e) => e.domain === "finance");
  const en = sorted.filter((e) => e.domain === "energy");
  const out: LedgerEntry[] = [];
  const first = hash(date) % 2 === 0 ? fin : en;
  const second = first === fin ? en : fin;
  while (out.length < size && (first.length || second.length)) {
    const next = (out.length % 2 === 0 ? first : second).shift() ?? (first.shift() || second.shift());
    if (next) out.push(next);
  }
  return out;
}

export function reviewQuestion(state: AppState, conceptId: string, questionId: string): Question | undefined {
  return questionsFor(state, conceptId).find((qq) => qq.id === questionId);
}

/** Freeze today's review set. Idempotent: refresh keeps the same questions. */
export function startReview(state: AppState, date: string): AppState {
  const { day } = requireDay(state, date);
  if (day.review) return state;
  const s = structuredClone(state);
  const picks = selectReview(s, date);
  s.days[date].review = picks.map((e) => {
    const bank = questionsFor(s, e.conceptId);
    const question = bank[hash(date + e.conceptId) % bank.length];
    return { conceptId: e.conceptId, questionId: question.id };
  });
  // With nothing earned yet, there is nothing to review — not a blocker.
  if (picks.length === 0) s.days[date].reviewComplete = true;
  return tryCompleteDay(s, date, new Date());
}

export function answerReview(
  state: AppState,
  date: string,
  questionId: string,
  choice: number,
  now: Date = new Date(),
): AppState {
  const { day } = requireDay(state, date);
  const item = day.review?.find((r) => r.questionId === questionId);
  if (!item) throw new Error(`Review question ${questionId} is not in today's review`);
  if (item.response !== undefined) return state; // locked
  // Defense in depth: review may only touch earned concepts.
  if (!isEarned(state, item.conceptId)) throw new Error(`Concept ${item.conceptId} is not earned`);
  const question = reviewQuestion(state, item.conceptId, questionId);
  if (!question) throw new Error(`Unknown review question ${questionId}`);
  if (!Number.isInteger(choice) || choice < 0 || choice >= question.choices.length) {
    throw new Error(`Invalid choice ${choice}`);
  }

  const s = structuredClone(state);
  const it = s.days[date].review!.find((r) => r.questionId === questionId)!;
  it.response = choice;
  it.correct = choice === question.answerIndex;

  const entry = s.ledger[item.conceptId];
  entry.status = it.correct ? promote(entry.status, 1) : promote(entry.status, -1);
  entry.nextReviewAt = addDays(date, it.correct ? REVIEW_INTERVAL_DAYS[entry.status] : 1);

  if (s.days[date].review!.every((r) => r.response !== undefined)) s.days[date].reviewComplete = true;
  return tryCompleteDay(s, date, now);
}

/* ------------------------- completion, XP, streak ------------------------ */

export function dayScore(state: AppState, date: string): { correct: number; total: number } {
  const lesson = state.lessons[date];
  const day = state.days[date];
  if (!lesson || !day) return { correct: 0, total: 0 };
  let correct = 0;
  let total = 0;
  for (const domain of ["finance", "energy"] as const) {
    const a = quizAttempt(state, date, domain);
    total += lesson[domain].quiz.questions.length;
    correct += a ? Object.values(a.correct).filter(Boolean).length : 0;
  }
  for (const r of day.review ?? []) {
    total += 1;
    if (r.correct) correct += 1;
  }
  return { correct, total };
}

/**
 * Credit XP and streak exactly once, and only when finance quiz, energy quiz
 * and the applicable review are all complete.
 */
export function tryCompleteDay(state: AppState, date: string, now: Date = new Date()): AppState {
  const day = state.days[date];
  if (!day || day.completedAt) return state;
  if (!(day.financeComplete && day.energyComplete && day.reviewComplete)) return state;

  // Re-verify from attempts rather than trusting the flags alone.
  const fin = quizAttempt(state, date, "finance");
  const en = quizAttempt(state, date, "energy");
  if (!fin?.complete || !en?.complete) return state;
  if (day.review && day.review.some((r) => r.response === undefined)) return state;

  const s = structuredClone(state);
  const { correct } = dayScore(s, date);
  const xp = correct * XP_PER_CORRECT + XP_DAY_BONUS;
  s.days[date].completedAt = now.toISOString();
  s.days[date].awardedXp = xp;
  s.xp += xp;

  const last = s.streak.lastCompletedDate;
  if (last === addDays(date, -1)) s.streak.current += 1;
  else if (last !== date) s.streak.current = 1;
  s.streak.lastCompletedDate = date;
  s.streak.longest = Math.max(s.streak.longest, s.streak.current);
  return s;
}

/** The streak as it should be displayed today (broken streaks show 0). */
export function displayStreak(state: AppState, today: string): number {
  const last = state.streak.lastCompletedDate;
  if (!last) return 0;
  if (last === today || last === addDays(today, -1)) return state.streak.current;
  return 0;
}
