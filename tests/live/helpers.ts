import fs from "node:fs";
import path from "node:path";
import { costUsd } from "@/lib/pricing";
import type { RunTrace } from "@/server/generate";

export const EVIDENCE = path.join(process.cwd(), "evidence");

export function saveEvidence(name: string, data: unknown) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, name), JSON.stringify(data, null, 2) + "\n");
}

export function summarize(t: RunTrace) {
  return {
    runId: t.runId,
    startedAt: t.startedAt,
    result: t.result,
    error: t.error ?? null,
    model: t.model,
    totalMs: t.totalMs,
    retrievalMs: t.retrieval.ms,
    feedsOk: t.retrieval.feeds.filter((f) => f.ok).length,
    feedsTotal: t.retrieval.feeds.length,
    itemsKept: t.retrieval.itemsKept,
    quarantined: t.retrieval.quarantined.length,
    attempts: t.attempts.length,
    attemptErrors: t.attempts.map((a) => a.errors),
    modelCallMs: t.attempts.map((a) => a.latencyMs),
    responseIds: t.attempts.map((a) => a.responseId),
    gatewayCache: t.attempts.map((a) => a.gatewayCache),
    usage: t.totalUsage,
    costUsd: costUsd(t.totalUsage),
    concepts: t.concepts ?? null,
  };
}

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
