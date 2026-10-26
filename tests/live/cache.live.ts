import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EARNED_SEED, PENDING_SEED } from "@/lib/concepts";
import { providerConfig } from "@/server/env";
import { generateLesson, writeTrace } from "@/server/generate";
import { retrieveSources } from "@/server/sources";
import { EVIDENCE, localDate, saveEvidence, summarize } from "./helpers";

/**
 * Cost experiment: two different learners on the same day, same news.
 * Baseline (evidence/cache-experiment-baseline.json): one input message — the
 * second learner reused only 1,141 cached tokens in either ordering.
 * Now: shared news in its own message with an explicit cache breakpoint.
 */
describe("prompt-cache experiment", () => {
  it("measures cached input tokens for a second, different learner", async () => {
    const cfg = providerConfig();
    expect(cfg).not.toBeNull();
    const date = localDate();
    const sources = await retrieveSources(); // frozen so both learners see identical news
    const retrieve = async () => sources;
    const learnerA = { earned: EARNED_SEED, pending: PENDING_SEED };
    const learnerB = {
      earned: EARNED_SEED.filter((c) => c.domain === "energy"),
      pending: [...EARNED_SEED.filter((c) => c.domain === "finance"), ...PENDING_SEED],
    };
    const a = await generateLesson(cfg!, learnerA, date, { retrieve, forceRefresh: true });
    const b = await generateLesson(cfg!, learnerB, date, { retrieve, forceRefresh: true });
    writeTrace(a.trace);
    writeTrace(b.trace);
    const baselineFile = path.join(EVIDENCE, "cache-experiment-baseline.json");
    const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, "utf8")).results : null;
    saveEvidence("cache-experiment.json", {
      ranAt: new Date().toISOString(),
      note: "Learner B runs right after learner A with identical sources but a different ledger.",
      results: {
        ...(baseline ? { "single-message (baseline)": baseline["sources-first"] } : {}),
        "shared-block-with-breakpoint": { learnerA: summarize(a.trace), learnerB: summarize(b.trace) },
      },
    });
    console.log("B cached:", b.trace.totalUsage.cachedInputTokens, "of", b.trace.totalUsage.inputTokens);
  });
});
