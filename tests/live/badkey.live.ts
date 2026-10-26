import { describe, expect, it } from "vitest";
import { EARNED_SEED, PENDING_SEED } from "@/lib/concepts";
import { generateLesson } from "@/server/generate";
import { localDate, saveEvidence, summarize } from "./helpers";

describe("invalid API key", () => {
  it("fails cleanly with an honest error and no key in the error or trace", async () => {
    const badKey = "invalid-key-for-testing-0000";
    const { lesson, trace } = await generateLesson(
      { provider: "portkey", baseUrl: "https://api.portkey.ai/v1", model: "gpt-6-luna", apiKey: badKey },
      { earned: EARNED_SEED, pending: PENDING_SEED },
      localDate(),
    );
    expect(lesson).toBeUndefined();
    expect(trace.result).toBe("failed");
    expect(JSON.stringify(trace)).not.toContain(badKey);
    saveEvidence("badkey.json", summarize(trace));
    console.log(JSON.stringify(summarize(trace)));
  });
});
