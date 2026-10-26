import { z } from "zod";

/**
 * Data contracts for Daily Signal.
 *
 * Lesson content (which may come from an LLM) is validated with these schemas
 * before the app touches it. Learner state (ledger, attempts, XP, streak) is
 * owned by code in ledger.ts — nothing in a Lesson can write to it directly.
 */

export const DomainSchema = z.enum(["finance", "energy"]);
export type Domain = z.infer<typeof DomainSchema>;

export const MasterySchema = z.enum(["New", "Developing", "Comfortable", "Strong"]);
export type Mastery = z.infer<typeof MasterySchema>;
export const MASTERY_ORDER: Mastery[] = ["New", "Developing", "Comfortable", "Strong"];

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "stable slug id");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SourceSchema = z.object({
  id,
  title: z.string().min(3).max(300),
  publisher: z.string().min(2).max(80),
  url: z.url().refine((u) => u.startsWith("https://"), "https only"),
  publishedAt: isoDate,
});
export type Source = z.infer<typeof SourceSchema>;

export const NewsItemSchema = z.object({
  headline: z.string().min(3).max(140),
  /** What the source reports. Every item must cite at least one source. */
  fact: z.string().min(10).max(500),
  /** Why it matters — labeled as analysis in the UI. */
  soWhat: z.string().min(10).max(400),
  sourceIds: z.array(id).min(1).max(3),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const QuestionSchema = z.object({
  id,
  prompt: z.string().min(5).max(400),
  choices: z.array(z.string().min(1).max(200)).min(2).max(5),
  answerIndex: z.number().int().min(0),
  explanation: z.string().min(5).max(500),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuizSchema = z.object({
  id,
  conceptId: id,
  questions: z.array(QuestionSchema).min(2).max(3),
});
export type Quiz = z.infer<typeof QuizSchema>;

export const ConceptLessonSchema = z.object({
  conceptId: id,
  conceptName: z.string().min(2).max(80),
  /** One-line hook, shown large. */
  hook: z.string().min(5).max(200),
  intuition: z.string().min(20).max(900),
  example: z.string().min(20).max(900),
});
export type ConceptLesson = z.infer<typeof ConceptLessonSchema>;

export const DomainSectionSchema = z.object({
  domain: DomainSchema,
  news: z.array(NewsItemSchema).min(1).max(3),
  concept: ConceptLessonSchema,
  quiz: QuizSchema,
  /** Held back for future spaced repetition; usable only once the concept is earned. */
  reviewQuestion: QuestionSchema,
});
export type DomainSection = z.infer<typeof DomainSectionSchema>;

export const GenerationMetaSchema = z.object({
  runId: z.string().max(64),
  provider: z.string().max(32),
  model: z.string().max(64),
  latencyMs: z.number().int().min(0),
  attempts: z.number().int().min(1),
  sourcesConsidered: z.number().int().min(0),
  /** Gateway cache status of the final model call ("HIT" = replayed, no new generation). */
  gatewayCache: z.string().max(16).nullable().optional(),
  /** Feed items dropped by the injection screen before the model saw them. */
  quarantined: z.number().int().min(0).optional(),
  feedsOk: z.number().int().min(0),
  feedsTotal: z.number().int().min(0),
  usage: z.object({
    inputTokens: z.number().int().nullable(),
    cachedInputTokens: z.number().int().nullable(),
    outputTokens: z.number().int().nullable(),
    reasoningTokens: z.number().int().nullable(),
  }),
});
export type GenerationMeta = z.infer<typeof GenerationMetaSchema>;

export const LessonSchema = z
  .object({
    id,
    mode: z.enum(["live", "demo"]),
    /** Date the content was generated (live) or captured (demo fixture). */
    generatedAt: z.iso.datetime({ offset: true }),
    title: z.string().min(3).max(120),
    intro: z.string().min(10).max(400),
    estimatedMinutes: z.number().int().min(5).max(15),
    sources: z.array(SourceSchema).min(1).max(10),
    finance: DomainSectionSchema,
    energy: DomainSectionSchema,
    /** Provenance for live lessons: what the agent run actually did. */
    generation: GenerationMetaSchema.optional(),
  })
  .superRefine((lesson, ctx) => {
    const sourceIds = new Set(lesson.sources.map((s) => s.id));
    for (const key of ["finance", "energy"] as const) {
      const section = lesson[key];
      if (section.domain !== key) {
        ctx.addIssue({ code: "custom", message: `${key} section has domain ${section.domain}` });
      }
      if (section.quiz.conceptId !== section.concept.conceptId) {
        ctx.addIssue({ code: "custom", message: `${key} quiz concept does not match lesson concept` });
      }
      for (const item of section.news) {
        for (const sid of item.sourceIds) {
          if (!sourceIds.has(sid)) {
            ctx.addIssue({ code: "custom", message: `${key} news cites unknown source ${sid}` });
          }
        }
      }
      for (const q of [...section.quiz.questions, section.reviewQuestion]) {
        if (q.answerIndex >= q.choices.length) {
          ctx.addIssue({ code: "custom", message: `question ${q.id} answerIndex out of range` });
        }
      }
    }
  });
export type Lesson = z.infer<typeof LessonSchema>;

/* ---------------- Learner state (client-side, code-owned) ---------------- */

export const ConceptRefSchema = z.object({
  conceptId: id,
  name: z.string().min(2).max(80),
  domain: DomainSchema,
});
export type ConceptRef = z.infer<typeof ConceptRefSchema>;

export const LedgerEntrySchema = ConceptRefSchema.extend({
  status: MasterySchema,
  /** Absent for seeded legacy knowledge: we don't invent dates. */
  earnedAt: z.iso.datetime({ offset: true }).optional(),
  nextReviewAt: isoDate.optional(),
  origin: z.enum(["seed", "quiz"]),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const QuizAttemptSchema = z.object({
  /** `${dayDate}|${quizId}` — scoped to a day so a reused fixture can't pre-complete tomorrow. */
  key: z.string(),
  quizId: id,
  conceptId: id,
  /** questionId -> chosen choice index. Answers are locked once recorded. */
  responses: z.record(z.string(), z.number().int().min(0)),
  correct: z.record(z.string(), z.boolean()),
  complete: z.boolean(),
  submittedAt: z.iso.datetime({ offset: true }).optional(),
});
export type QuizAttempt = z.infer<typeof QuizAttemptSchema>;

export const ReviewItemSchema = z.object({
  conceptId: id,
  questionId: id,
  response: z.number().int().min(0).optional(),
  correct: z.boolean().optional(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const DailyProgressSchema = z.object({
  date: isoDate,
  lessonId: id,
  /** Where the learner is in the lesson flow, so refresh resumes in place. */
  step: z.number().int().min(0),
  financeComplete: z.boolean(),
  energyComplete: z.boolean(),
  /** Review set is frozen on first visit so refresh can't reshuffle it. */
  review: z.array(ReviewItemSchema).optional(),
  reviewComplete: z.boolean(),
  completedAt: z.iso.datetime({ offset: true }).optional(),
  awardedXp: z.number().int().min(0),
});
export type DailyProgress = z.infer<typeof DailyProgressSchema>;

export const AppStateSchema = z.object({
  schemaVersion: z.literal(2),
  ledger: z.record(z.string(), LedgerEntrySchema),
  /** Concepts taught/delivered but never quizzed. Never treated as prior knowledge. */
  pending: z.array(ConceptRefSchema),
  /** Review questions for concepts earned in-app, copied from their lesson at earn time. */
  reviewBank: z.record(z.string(), z.array(QuestionSchema)),
  attempts: z.record(z.string(), QuizAttemptSchema),
  days: z.record(z.string(), DailyProgressSchema),
  lessons: z.record(z.string(), LessonSchema),
  xp: z.number().int().min(0),
  streak: z.object({
    current: z.number().int().min(0),
    longest: z.number().int().min(0),
    lastCompletedDate: isoDate.optional(),
  }),
});
export type AppState = z.infer<typeof AppStateSchema>;
