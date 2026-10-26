import "server-only";
import fs from "node:fs";
import path from "node:path";
import { LessonSchema, type ConceptRef, type Domain, type Lesson } from "@/lib/schema";
import type { ProviderConfig } from "./env";
import { callModel, type ModelResult, type Usage } from "./model";
import { retrieveSources, type FeedReport, type Quarantined, type Retrieval, type SourceItem } from "./sources";
import { DRAFT_SCHEMA, SYSTEM_PROMPT, buildInput, type LessonDraft } from "./prompt";

/**
 * One traceable agent run:
 *   1. retrieve  — source tool fetches public feeds (sources.ts)
 *   2. curate+write — one model call selects stories/concepts and writes the
 *      lesson as strict JSON (the model sees earned + pending concept lists)
 *   3. validate  — code checks schema, citations, numbers and concept rules;
 *      on failure, one retry with the errors fed back
 * The model returns content only. It never sees or writes learner state.
 */

export const RUN_LIMITS = { maxAttempts: 2, modelTimeoutMs: 90_000 };

export type LearnerSnapshot = { earned: ConceptRef[]; pending: ConceptRef[] };

export type RunTrace = {
  runId: string;
  date: string;
  startedAt: string;
  provider: string;
  model: string;
  retrieval: { ms: number; feeds: FeedReport[]; itemsKept: number; quarantined: Quarantined[] };
  attempts: { n: number; latencyMs: number; usage: Usage; errors: string[]; responseId: string | null; gatewayCache: string | null }[];
  result: "ok" | "failed";
  error?: string;
  lessonId?: string;
  concepts?: { finance: string; energy: string };
  citedSources?: number;
  totalMs: number;
  totalUsage: Usage;
};

const slug = (s: string, max = 48) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "") || "concept";

/** Numbers like 5.7, 52, 80%, 1,200, 2027 — used to check facts against their sources. */
function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

export function assembleLesson(
  draft: LessonDraft,
  items: SourceItem[],
  learner: LearnerSnapshot,
  ctx: { date: string; runId: string; generatedAt: string },
): { lesson?: Lesson; errors: string[] } {
  const errors: string[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const earned = new Set(learner.earned.map((c) => c.conceptId));
  const lessonId = slug(`live-${ctx.date}-${ctx.runId}`, 60);
  const cited = new Set<string>();

  const section = (domain: Domain) => {
    const d = draft[domain];
    const conceptId = slug(d.concept.conceptId);
    if (earned.has(conceptId)) errors.push(`${domain}: concept "${conceptId}" is already earned; pick a concept the learner has not earned`);
    if (d.questions.length !== 3) errors.push(`${domain}: exactly 3 quiz questions required`);
    for (const [i, n] of d.news.entries()) {
      const srcs = n.sourceIds.map((id) => byId.get(id));
      if (!n.sourceIds.length) errors.push(`${domain} news ${i + 1}: must cite a source id`);
      srcs.forEach((s, j) => {
        if (!s) errors.push(`${domain} news ${i + 1}: unknown source id "${n.sourceIds[j]}" (use only ids from the provided sources)`);
        else cited.add(s.id);
      });
      const sourceText = srcs.map((s) => (s ? `${s.title} ${s.snippet}` : "")).join(" ").replace(/,/g, "");
      for (const num of numbersIn(n.fact)) {
        if (!sourceText.includes(num)) errors.push(`${domain} news ${i + 1}: fact states "${num}" which is not in the cited source text; remove it or quote the source`);
      }
    }
    const q = (x: LessonDraft["finance"]["reviewQuestion"], id: string) => ({ id, ...x });
    return {
      domain,
      news: d.news.map((n) => ({ ...n, sourceIds: n.sourceIds.filter((id) => byId.has(id)) })),
      concept: { ...d.concept, conceptId },
      quiz: {
        id: `${lessonId}-${domain[0]}`.slice(0, 64),
        conceptId,
        questions: d.questions.map((x, i) => q(x, `${lessonId}-${domain[0]}${i + 1}`.slice(0, 64))),
      },
      reviewQuestion: q(d.reviewQuestion, slug(`rv-${conceptId.slice(0, 40)}-${ctx.date}`, 64)),
    };
  };

  const finance = section("finance");
  const energy = section("energy");
  if (finance.concept.conceptId === energy.concept.conceptId) errors.push("finance and energy concepts must differ");

  const sources = [...cited].map((id) => {
    const s = byId.get(id)!;
    return { id: s.id, title: s.title, publisher: s.publisher, url: s.url, publishedAt: s.publishedAt };
  });

  const candidate = {
    id: lessonId,
    mode: "live" as const,
    generatedAt: ctx.generatedAt,
    title: draft.title,
    intro: draft.intro,
    estimatedMinutes: Math.min(15, Math.max(5, Math.round(draft.estimatedMinutes))),
    sources,
    finance,
    energy,
  };
  const parsed = LessonSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 8)) errors.push(`${issue.path.join(".")}: ${issue.message}`);
  }
  if (errors.length) return { errors };
  return { lesson: parsed.data, errors };
}

function addUsage(a: Usage, b: Usage): Usage {
  const add = (x: number | null, y: number | null) => (x === null && y === null ? null : (x ?? 0) + (y ?? 0));
  return {
    inputTokens: add(a.inputTokens, b.inputTokens),
    cachedInputTokens: add(a.cachedInputTokens, b.cachedInputTokens),
    outputTokens: add(a.outputTokens, b.outputTokens),
    reasoningTokens: add(a.reasoningTokens, b.reasoningTokens),
  };
}

const EMPTY_USAGE: Usage = { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null };

export async function generateLesson(
  cfg: ProviderConfig,
  learner: LearnerSnapshot,
  date: string,
  deps: {
    retrieve?: () => Promise<Retrieval>;
    model?: typeof callModel;
    forceRefresh?: boolean;
  } = {},
): Promise<{ lesson?: Lesson; trace: RunTrace }> {
  const started = Date.now();
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const trace: RunTrace = {
    runId,
    date,
    startedAt: new Date(started).toISOString(),
    provider: cfg.provider,
    model: cfg.model,
    retrieval: { ms: 0, feeds: [], itemsKept: 0, quarantined: [] },
    attempts: [],
    result: "failed",
    totalMs: 0,
    totalUsage: EMPTY_USAGE,
  };

  // 1. Retrieve
  const r0 = Date.now();
  const { items, reports, quarantined = [] } = await (deps.retrieve ?? retrieveSources)();
  trace.retrieval = { ms: Date.now() - r0, feeds: reports, itemsKept: items.length, quarantined };
  const perDomain = (d: Domain) => items.filter((i) => i.domain === d).length;
  if (perDomain("finance") < 1 || perDomain("energy") < 1) {
    trace.error = "Not enough current sources retrieved";
    trace.totalMs = Date.now() - started;
    return { trace };
  }

  // 2–3. Write + validate, with one corrective retry
  const input = buildInput(date, learner, items);
  let feedback: string[] = [];
  for (let n = 1; n <= RUN_LIMITS.maxAttempts; n++) {
    let res: ModelResult;
    try {
      res = await (deps.model ?? callModel)(cfg, {
        instructions: SYSTEM_PROMPT,
        input: feedback.length
          ? {
              shared: input.shared,
              personal: `${input.personal}\n\n<validation_errors_from_previous_attempt>\n${feedback.map((e) => `- ${e}`).join("\n")}\n</validation_errors_from_previous_attempt>\nFix every error above.`,
            }
          : input,
        schemaName: "daily_lesson",
        schema: DRAFT_SCHEMA,
        timeoutMs: RUN_LIMITS.modelTimeoutMs,
        forceRefresh: deps.forceRefresh,
      });
    } catch (err) {
      trace.error = err instanceof Error ? err.message : "Model call failed";
      break;
    }
    trace.model = res.model;
    trace.totalUsage = addUsage(trace.totalUsage, res.usage);
    const attempt = {
      n,
      latencyMs: res.latencyMs,
      usage: res.usage,
      errors: [] as string[],
      responseId: res.responseId ?? null,
      gatewayCache: res.gatewayCache ?? null,
    };
    trace.attempts.push(attempt);

    let draft: LessonDraft;
    try {
      draft = JSON.parse(res.text) as LessonDraft;
    } catch {
      attempt.errors = ["Response was not valid JSON"];
      feedback = attempt.errors;
      continue;
    }
    const { lesson, errors } = assembleLesson(draft, items, learner, {
      date,
      runId,
      generatedAt: new Date().toISOString(),
    });
    attempt.errors = errors;
    if (lesson) {
      lesson.generation = {
        runId,
        provider: cfg.provider,
        model: res.model,
        latencyMs: Date.now() - started,
        attempts: n,
        sourcesConsidered: items.length,
        quarantined: quarantined.length,
        gatewayCache: res.gatewayCache ?? null,
        feedsOk: reports.filter((x) => x.ok).length,
        feedsTotal: reports.length,
        usage: trace.totalUsage,
      };
      trace.result = "ok";
      trace.lessonId = lesson.id;
      trace.concepts = { finance: lesson.finance.concept.conceptId, energy: lesson.energy.concept.conceptId };
      trace.citedSources = lesson.sources.length;
      trace.totalMs = Date.now() - started;
      return { lesson, trace };
    }
    feedback = errors;
  }
  if (!trace.error) trace.error = "Generated lesson failed validation";
  trace.totalMs = Date.now() - started;
  return { trace };
}

/** Persist a run trace for evidence. Never contains keys or headers. */
export function writeTrace(trace: RunTrace): void {
  try {
    const dir = path.join(process.cwd(), "runs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${trace.startedAt.replace(/[:.]/g, "-")}-${trace.runId}.json`), JSON.stringify(trace, null, 2));
  } catch {
    // read-only hosts: tracing is best-effort
  }
}
