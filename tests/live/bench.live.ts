import { describe, expect, it } from "vitest";
import { EARNED_SEED, PENDING_SEED } from "@/lib/concepts";
import { PRICING } from "@/lib/pricing";
import { providerConfig } from "@/server/env";
import { generateLesson, writeTrace } from "@/server/generate";
import { localDate, saveEvidence, summarize } from "./helpers";

describe("benchmark: 3 back-to-back live runs", () => {
  it("records success, latency, tokens (incl. cached) and list-price cost", async () => {
    const cfg = providerConfig();
    expect(cfg, "no API key configured").not.toBeNull();
    // Probe: an identical request without force-refresh — is it a gateway replay?
    const probe = await generateLesson(cfg!, { earned: EARNED_SEED, pending: PENDING_SEED }, localDate());
    writeTrace(probe.trace);
    const replayProbe = summarize(probe.trace);
    console.log("replay probe:", JSON.stringify(replayProbe));

    const runs = [];
    for (let i = 0; i < 3; i++) {
      // forceRefresh: measure real generations, not gateway-cached replays of an identical request.
      const { lesson, trace } = await generateLesson(cfg!, { earned: EARNED_SEED, pending: PENDING_SEED }, localDate(), { forceRefresh: true });
      writeTrace(trace);
      runs.push({ ...summarize(trace), title: lesson?.title ?? null });
      console.log(`run ${i + 1}:`, JSON.stringify(runs[i]));
    }
    saveEvidence("bench.json", { pricing: PRICING, provider: cfg!.provider, forceRefresh: true, runs, replayProbe });
    expect(runs.length).toBe(3);
  });
});
