import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ConceptRefSchema, LessonSchema, type Lesson } from "@/lib/schema";
import { forceDemo, providerConfig } from "@/server/env";
import { generateLesson, writeTrace, type RunTrace } from "@/server/generate";
import { allowRun, type LimiterState } from "@/server/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const BodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  earned: z.array(ConceptRefSchema).max(300),
  pending: z.array(ConceptRefSchema).max(300),
});

/* ---- spend controls: per-IP limit, global daily cap, in-flight de-dupe ---- */
const PER_IP_PER_HOUR = 6;
const limiter: LimiterState = { byIp: new Map(), byDay: new Map() };
const inFlight = new Map<string, Promise<{ lesson?: Lesson; trace: RunTrace }>>();

function maxRunsPerDay(): number {
  const n = Number(process.env.DAILY_SIGNAL_MAX_RUNS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : 40;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const cacheDir = () => path.join(process.cwd(), ".cache", "lessons");

function readCache(key: string): Lesson | null {
  try {
    return LessonSchema.parse(JSON.parse(fs.readFileSync(path.join(cacheDir(), `${key}.json`), "utf8")));
  } catch {
    return null;
  }
}

function writeCache(key: string, lesson: Lesson) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(path.join(cacheDir(), `${key}.json`), JSON.stringify(lesson));
  } catch {
    // best-effort
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const cfg = providerConfig();
  return json({
    live: Boolean(cfg) && !forceDemo(),
    provider: cfg?.provider ?? null,
    model: cfg?.model ?? null,
  });
}

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad_request", message: "Invalid request." }, 400);
  const { date, earned, pending } = parsed.data;

  // Client dates may differ by timezone, but not by more than a day.
  const serverDay = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (Math.abs(Date.parse(`${date}T00:00:00Z`) - serverDay) > 2 * 86_400_000) {
    return json({ error: "bad_date", message: "Lessons can only be generated for today." }, 400);
  }

  if (forceDemo()) return json({ error: "demo_mode", message: "Live generation is turned off (DAILY_SIGNAL_MODE=demo)." }, 503);
  const cfg = providerConfig();
  if (!cfg) {
    return json(
      { error: "no_api_key", message: "No PORTKEY_API_KEY or OPENAI_API_KEY found in .env (repo folder or the folder above)." },
      503,
    );
  }

  // Same day + same ledger → same lesson, zero tokens.
  const key = `${date}-${hash(JSON.stringify([earned.map((c) => c.conceptId).sort(), pending.map((c) => c.conceptId).sort()]))}`;
  const cached = readCache(key);
  if (cached) return json({ lesson: cached, cached: true });

  let run = inFlight.get(key);
  if (!run) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const allowed = allowRun(limiter, ip, Date.now(), { perIpPerHour: PER_IP_PER_HOUR, perDay: maxRunsPerDay() });
    if (!allowed.ok) {
      return json(
        allowed.reason === "rate_limited"
          ? { error: "rate_limited", message: "Too many lessons generated this hour. Try again later." }
          : { error: "daily_cap", message: "Daily generation budget reached on this server." },
        429,
      );
    }

    run = generateLesson(cfg, { earned, pending }, date).finally(() => inFlight.delete(key));
    inFlight.set(key, run);
  }

  const { lesson, trace } = await run;
  writeTrace(trace);
  console.log(
    `[daily-signal] run ${trace.runId} ${trace.result} ${trace.totalMs}ms model=${trace.model} ` +
      `in=${trace.totalUsage.inputTokens} cached=${trace.totalUsage.cachedInputTokens} out=${trace.totalUsage.outputTokens} ` +
      `attempts=${trace.attempts.length} quarantined=${trace.retrieval.quarantined.length}${trace.error ? ` error="${trace.error}"` : ""}`,
  );
  if (!lesson) return json({ error: "generation_failed", message: trace.error ?? "Generation failed." }, 502);
  writeCache(key, lesson);
  return json({ lesson, cached: false });
}
