import { describe, expect, it } from "vitest";
import { EARNED_SEED, PENDING_SEED } from "@/lib/concepts";
import { assembleLesson, generateLesson } from "@/server/generate";
import type { ModelResult } from "@/server/model";
import type { LessonDraft } from "@/server/prompt";
import { cleanText, parseFeed, selectItems, type SourceItem } from "@/server/sources";
import type { ProviderConfig } from "@/server/env";

const NOW = new Date("2026-10-25T12:00:00Z");
const learner = { earned: EARNED_SEED, pending: PENDING_SEED };
const cfg: ProviderConfig = { provider: "portkey", baseUrl: "https://example.invalid", model: "test-model", apiKey: "sk-test" };

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>NextEra secures $5.7B for &lsquo;hub&rsquo; projects</title><link>https://www.utilitydive.com/news/nextera/1/</link>
<pubDate>Fri, 23 Oct 2026 08:00:00 -0400</pubDate><description><![CDATA[<p>The company said it raised $5.7 billion.</p><script>alert(1)</script>]]></description></item>
<item><title>Old story</title><link>https://www.utilitydive.com/news/old/</link><pubDate>Mon, 01 Jan 2024 08:00:00 -0400</pubDate><description>old</description></item>
<item><title>Insecure link</title><link>http://example.com/x</link><pubDate>Fri, 23 Oct 2026 08:00:00 -0400</pubDate><description>x</description></item>
</channel></rss>`;

const feed = { publisher: "Utility Dive", url: "https://www.utilitydive.com/feeds/news/", domain: "energy" as const };

const items: SourceItem[] = [
  { id: "s-fin1", domain: "finance", publisher: "CNBC", title: "Banks earn $52 billion from trading", snippet: "Wall Street’s Big Three generated $52 billion, about 80% of the market.", url: "https://www.cnbc.com/a", publishedAt: "2026-10-21" },
  { id: "s-en1", domain: "energy", publisher: "Canary Media", title: "Google plans big virtual power plant in PJM", snippet: "Google and Voltus are going after a gigawatt of VPP capacity.", url: "https://www.canarymedia.com/b", publishedAt: "2026-10-22" },
];

const q = (correct = 1) => ({ prompt: "Which is right here?", choices: ["A one", "B two", "C three", "D four"], answerIndex: correct, explanation: "Because it is." });

function draft(over: Partial<{ finFact: string; finConcept: string; finSource: string }> = {}): LessonDraft {
  const section = (concept: string, sourceId: string, fact: string) => ({
    news: [{ headline: "A headline", fact, soWhat: "Why this matters for you.", sourceIds: [sourceId] }],
    concept: { conceptId: concept, conceptName: "Some concept", hook: "A short hook.", intuition: "An intuition that is long enough to pass.", example: "An example that is long enough to pass." },
    questions: [q(0), q(1), q(2)],
    reviewQuestion: q(3),
  });
  return {
    title: "Today’s lesson",
    intro: "A short introduction.",
    estimatedMinutes: 9,
    finance: section(over.finConcept ?? "Debt Service Coverage Ratio", over.finSource ?? "s-fin1", over.finFact ?? "The Big Three generated $52 billion, about 80% of the market, CNBC reports."),
    energy: section("virtual-power-plants", "s-en1", "Google and Voltus are pursuing a gigawatt of VPP capacity, Canary Media reports."),
  };
}

const ctx = { date: "2026-10-25", runId: "testrun", generatedAt: NOW.toISOString() };

describe("source retrieval tool", () => {
  it("parses RSS, decodes entities, strips markup/scripts, drops stale and non-https items", () => {
    const out = parseFeed(RSS, feed, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("NextEra secures $5.7B for ‘hub’ projects");
    expect(out[0].snippet).toBe("The company said it raised $5.7 billion.");
    expect(out[0].publishedAt).toBe("2026-10-23");
    expect(out[0].url).toMatch(/^https:\/\//);
  });

  it("caps snippet length and removes control/bidi characters", () => {
    const s = cleanText(`hello‮world ${"x".repeat(1000)}`, 50);
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s).not.toMatch(/‮/);
  });

  it("balances publishers instead of letting one feed dominate", () => {
    const mk = (pub: string, n: number): SourceItem[] =>
      Array.from({ length: n }, (_, i) => ({ id: `s-${pub}${i}`, domain: "finance", publisher: pub, title: "t", snippet: "s", url: `https://x/${pub}${i}`, publishedAt: "2026-10-2" + (5 - (i % 5)) }));
    const out = selectItems([...mk("BBC", 10), ...mk("CNBC", 3)]);
    expect(out.slice(0, 2).map((i) => i.publisher).sort()).toEqual(["BBC", "CNBC"]);
  });
});

describe("lesson validation (code, not the model, decides what is acceptable)", () => {
  it("assembles a valid lesson: sources come from retrieval, ids are server-assigned", () => {
    const { lesson, errors } = assembleLesson(draft(), items, learner, ctx);
    expect(errors).toEqual([]);
    expect(lesson!.mode).toBe("live");
    expect(lesson!.finance.concept.conceptId).toBe("debt-service-coverage-ratio");
    expect(lesson!.sources.map((s) => s.url)).toEqual(["https://www.cnbc.com/a", "https://www.canarymedia.com/b"]);
    expect(lesson!.finance.quiz.questions.map((x) => x.id)).toHaveLength(3);
  });

  it("rejects an invented source id", () => {
    const { lesson, errors } = assembleLesson(draft({ finSource: "s-made-up" }), items, learner, ctx);
    expect(lesson).toBeUndefined();
    expect(errors.join(" ")).toMatch(/unknown source id/);
  });

  it("rejects a number that does not appear in the cited source", () => {
    const { lesson, errors } = assembleLesson(draft({ finFact: "The banks earned $61 billion, CNBC reports." }), items, learner, ctx);
    expect(lesson).toBeUndefined();
    expect(errors.join(" ")).toMatch(/"61"/);
  });

  it("rejects teaching an already-earned concept", () => {
    const { lesson, errors } = assembleLesson(draft({ finConcept: "credit-spreads" }), items, learner, ctx);
    expect(lesson).toBeUndefined();
    expect(errors.join(" ")).toMatch(/already earned/);
  });
});

describe("agent run", () => {
  const usage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500, reasoningTokens: 100 };
  const reply = (d: unknown): ModelResult => ({ text: JSON.stringify(d), usage, latencyMs: 5, model: "test-model", responseId: null, gatewayCache: null });

  it("retries once with validation errors, then succeeds; usage is summed", async () => {
    const inputs: string[] = [];
    const replies = [reply(draft({ finSource: "s-bogus" })), reply(draft())];
    const { lesson, trace } = await generateLesson(cfg, learner, "2026-10-25", {
      retrieve: async () => ({ items, reports: [] }),
      model: async (_c, opts) => {
        inputs.push(JSON.stringify(opts.input));
        return replies.shift()!;
      },
    });
    expect(lesson).toBeDefined();
    expect(trace.attempts).toHaveLength(2);
    expect(inputs[1]).toMatch(/validation_errors_from_previous_attempt/);
    expect(trace.totalUsage.inputTokens).toBe(2000);
    expect(lesson!.generation!.usage.outputTokens).toBe(1000);
  });

  it("fails honestly after the attempt cap instead of returning an unvalidated lesson", async () => {
    let calls = 0;
    const { lesson, trace } = await generateLesson(cfg, learner, "2026-10-25", {
      retrieve: async () => ({ items, reports: [] }),
      model: async () => {
        calls++;
        return { ...reply({}), text: "not json" };
      },
    });
    expect(lesson).toBeUndefined();
    expect(calls).toBe(2);
    expect(trace.result).toBe("failed");
  });

  it("does not call the model when retrieval finds nothing", async () => {
    let calls = 0;
    const { lesson, trace } = await generateLesson(cfg, learner, "2026-10-25", {
      retrieve: async () => ({ items: [], reports: [] }),
      model: async () => {
        calls++;
        return reply(draft());
      },
    });
    expect(lesson).toBeUndefined();
    expect(calls).toBe(0);
    expect(trace.error).toMatch(/sources/);
  });

  it("never puts the API key in the model input or the trace", async () => {
    let seen = "";
    const { trace } = await generateLesson(cfg, learner, "2026-10-25", {
      retrieve: async () => ({ items, reports: [] }),
      model: async (_c, opts) => {
        seen = opts.instructions + JSON.stringify(opts.input);
        return reply(draft());
      },
    });
    expect(seen).not.toContain("sk-test");
    expect(JSON.stringify(trace)).not.toContain("sk-test");
  });
});
