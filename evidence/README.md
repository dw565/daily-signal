# Evidence

Machine-written records of real runs. Nothing here is hand-edited. No file contains API keys (checked by `npm run check:secrets`).

| File | What it shows | Produced by |
|---|---|---|
| `runs/*.json` | The first two live agent runs (Oct 26, 2026 UTC), full traces: feeds fetched, attempts, tokens, concepts chosen | Browser / `/api/lesson` |
| `bench.json` | 3 back-to-back **forced-fresh** live runs (latency, tokens, cached tokens, cost) plus a **gateway-replay probe**: an identical request without force-refresh was served from Portkey's cache (`x-portkey-cache-status: HIT`, ~1 s) | `npm run test:live -- tests/live/bench.live.ts` |
| `cache-experiment-baseline.json` | Two different learners, same news, prompt as ONE message (two orderings): learner B reused only 1,141 cached tokens | `tests/live/cache.live.ts` (earlier version) |
| `cache-experiment.json` | Same experiment after moving shared news into its own message with an explicit cache breakpoint: learner B reused 3,786 of 4,431 input tokens | `tests/live/cache.live.ts` |
| `redteam.json` | Malicious feed (`tests/fixtures/malicious-feed.xml`) against the real model, with the injection screen ON and OFF; whether any attack text reached the lesson; learner state before/after delivering and completing the lesson | `tests/live/redteam.live.ts` |
| `badkey.json` | Invalid API key: clean failure, honest error, key absent from trace | `tests/live/badkey.live.ts` |
| `tokenomics.json` | Cost per run / user / month at 1, 100 and 10,000 users, computed only from the real runs above | `npm run tokenomics` |

Note: an earlier benchmark accidentally measured Portkey cache replays (identical input → identical output in ~0.1 s). Those runs are excluded everywhere; `bench.json` now forces fresh generations and records each response id and cache header.
