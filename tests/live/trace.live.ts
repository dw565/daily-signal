import { describe, expect, it } from "vitest";
import { EARNED_SEED, PENDING_SEED } from "@/lib/concepts";
import { providerConfig } from "@/server/env";
import { generateLesson, writeTrace } from "@/server/generate";
import { buildInput } from "@/server/prompt";
import { retrieveSources } from "@/server/sources";
import { localDate, saveEvidence, summarize } from "./helpers";

/** One fully recorded run for the report: trace + retrieved items + prompt sizes + resulting lesson. */
describe("traced run", () => {
  it("records one real run end to end", async () => {
    const cfg = providerConfig();
    expect(cfg).not.toBeNull();
    const date = localDate();
    const retrieval = await retrieveSources();
    const learner = { earned: EARNED_SEED, pending: PENDING_SEED };
    const input = buildInput(date, learner, retrieval.items);
    const { lesson, trace } = await generateLesson(cfg!, learner, date, { retrieve: async () => retrieval, forceRefresh: true });
    writeTrace(trace);
    expect(lesson).toBeDefined();
    saveEvidence("traced-run.json", {
      summary: summarize(trace),
      trace,
      retrievedItems: retrieval.items.map(({ id, domain, publisher, publishedAt, title }) => ({ id, domain, publisher, publishedAt, title })),
      promptChars: { sharedBlock: input.shared.length, personalBlock: input.personal.length },
      lesson,
    });
  });
});
