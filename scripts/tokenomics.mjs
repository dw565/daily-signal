#!/usr/bin/env node
/**
 * Tokenomics from MEASURED runs. Inputs: evidence/bench.json (3 forced-fresh
 * runs + a gateway-replay probe), evidence/cache-experiment*.json and
 * evidence/redteam.json. Gateway replays (sub-5s model calls) are excluded.
 * Prices: OpenAI list price for gpt-6-luna (src/lib/pricing.ts).
 * Writes evidence/tokenomics.json and prints a summary.
 */
import fs from "node:fs";
import path from "node:path";

const ev = (f) => {
  const p = path.join(process.cwd(), "evidence", f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};
const bench = ev("bench.json");
const P = bench.pricing.perMillion;

// Collect every real (non-replay) successful run from the evidence files.
const runs = [];
const add = (label, r) => r && r.result === "ok" && Math.min(...(r.modelCallMs ?? [r.totalMs])) > 5000 && runs.push({ label, ...r });
bench.runs.forEach((r, i) => add(`bench ${i + 1}`, r));
for (const f of ["cache-experiment-baseline.json", "cache-experiment.json"]) {
  const x = ev(f)?.results ?? {};
  for (const [k, v] of Object.entries(x)) for (const who of ["learnerA", "learnerB"]) if (v[who]) add(`${f.replace(".json", "")}:${k}:${who}`, v[who]);
}
for (const [k, v] of Object.entries(ev("redteam.json")?.results ?? {})) add(`redteam:${k}`, v.run);
const seen = new Set();
const real = runs.filter((r) => !seen.has(r.runId) && seen.add(r.runId));

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const inTok = Math.round(avg(real.map((r) => r.usage.inputTokens)));
const outTok = Math.round(avg(real.map((r) => r.usage.outputTokens)));
const reasoning = Math.round(avg(real.map((r) => r.usage.reasoningTokens ?? 0)));
const latency = real.map((r) => r.totalMs);
const outs = real.map((r) => r.usage.outputTokens);

const cost = (input, cached, output) => ((input - cached) * P.input + cached * P.cachedInput + output * P.output) / 1e6;
const exp = ev("cache-experiment.json")?.results?.["shared-block-with-breakpoint"];
const sharedCached = exp ? exp.learnerB.usage.cachedInputTokens : null;
const INSTR_CACHED = 1141; // measured: cached prefix when only instructions + schema match

const scenarios = {
  noCache: cost(inTok, 0, outTok),
  instructionsCached: cost(inTok, INSTR_CACHED, outTok),
  sharedNewsCached: sharedCached === null ? null : cost(inTok, sharedCached, outTok),
};
const DAYS = 30;
// A solo user's one daily run is usually cold. At scale, most runs fall inside the
// cache lifetime of the day's shared news block, so they get the shared-news rate.
const perRunAtScale = scenarios.sharedNewsCached ?? scenarios.instructionsCached;
const soloMonth = scenarios.noCache * DAYS;
const scaleMonth = perRunAtScale * DAYS;

const result = {
  pricing: bench.pricing,
  realRuns: real.length,
  runLabels: real.map((r) => r.label),
  benchmark: `${bench.runs.filter((r) => r.result === "ok" && r.attempts === 1).length}/${bench.runs.length} forced-fresh runs succeeded on the first attempt`,
  latencySec: { avg: +(avg(latency) / 1000).toFixed(1), min: +(Math.min(...latency) / 1000).toFixed(1), max: +(Math.max(...latency) / 1000).toFixed(1) },
  avgTokensPerRun: { input: inTok, output: outTok, reasoningInsideOutput: reasoning },
  outputTokenRange: [Math.min(...outs), Math.max(...outs)],
  cachedTokensMeasured: { instructionsOnly: INSTR_CACHED, sharedNewsBlock: sharedCached },
  costPerRunUsd: Object.fromEntries(Object.entries(scenarios).map(([k, v]) => [k, v === null ? null : +v.toFixed(5)])),
  outputShareOfUncachedCost: +((outTok * P.output) / 1e6 / scenarios.noCache).toFixed(2),
  perUserPerMonthUsd: { soloUser: +soloMonth.toFixed(4), atScale: +scaleMonth.toFixed(4) },
  monthlyUsd: {
    users1: +soloMonth.toFixed(2),
    users100: +(100 * scaleMonth).toFixed(2),
    users10000: +(10_000 * scaleMonth).toFixed(2),
    oneSharedLessonForEveryone: +(DAYS * scenarios.noCache).toFixed(2),
  },
  gatewayReplay: bench.replayProbe
    ? { note: "Identical request without force-refresh was served from the Portkey cache.", modelCallMs: bench.replayProbe.modelCallMs, gatewayCache: bench.replayProbe.gatewayCache }
    : null,
  assumptions: [
    "One generation per learner per day; refresh/re-open hits the device cache, a second device hits the server cache (0 tokens).",
    "Review questions are produced with the lesson, so review costs 0 tokens.",
    "30 active days/month. List price, Standard tier; the course key is billed via Portkey, which we can't see.",
    "Prompt-cache lifetime is at least 30 minutes; the cached-input price applies only to runs inside that window.",
  ],
};
fs.writeFileSync(path.join(process.cwd(), "evidence", "tokenomics.json"), JSON.stringify(result, null, 2) + "\n");

const usd = (x, d = 4) => `$${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: d })}`;
console.log(`Real runs: ${real.length} · ${result.benchmark} · latency avg ${result.latencySec.avg}s (${result.latencySec.min}–${result.latencySec.max}s)`);
console.log(`Avg tokens/run: ${inTok} in · ${outTok} out (incl. ${reasoning} reasoning); output range ${result.outputTokenRange.join("–")}`);
console.log(`Cost/run: no cache ${usd(scenarios.noCache, 5)} · instructions cached ${usd(scenarios.instructionsCached, 5)} · shared news cached ${scenarios.sharedNewsCached === null ? "n/a" : usd(scenarios.sharedNewsCached, 5)}`);
console.log(`Output is ${Math.round(result.outputShareOfUncachedCost * 100)}% of an uncached run's cost`);
console.log(`Per user/month: solo ${usd(soloMonth)} · at scale ${usd(scaleMonth)}`);
console.log(`Monthly: 1 user ${usd(result.monthlyUsd.users1, 2)} · 100 users ${usd(result.monthlyUsd.users100, 2)} · 10,000 users ${usd(result.monthlyUsd.users10000, 2)} · one shared lesson for everyone ${usd(result.monthlyUsd.oneSharedLessonForEveryone, 2)}`);
