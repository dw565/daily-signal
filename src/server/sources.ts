import type { Domain } from "@/lib/schema";

/**
 * Source retrieval tool: public RSS feeds only (no logins, no scraping).
 * Each item keeps title, publisher, date, a short snippet and its URL.
 * Feed text is untrusted data — it is sanitized and length-capped here and
 * never interpreted as instructions.
 */

export type Feed = { publisher: string; url: string; domain: Domain };

export const FEEDS: Feed[] = [
  { publisher: "CNBC", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", domain: "finance" },
  { publisher: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", domain: "finance" },
  { publisher: "BBC News", url: "https://feeds.bbci.co.uk/news/business/rss.xml", domain: "finance" },
  { publisher: "U.S. EIA", url: "https://www.eia.gov/rss/todayinenergy.xml", domain: "energy" },
  { publisher: "Utility Dive", url: "https://www.utilitydive.com/feeds/news/", domain: "energy" },
  { publisher: "Canary Media", url: "https://www.canarymedia.com/rss.rss", domain: "energy" },
];

export const LIMITS = {
  feedTimeoutMs: 6000,
  maxFeedBytes: 1_500_000,
  itemsPerFeed: 6,
  maxItemsPerDomain: 12,
  titleChars: 200,
  snippetChars: 400,
  maxAgeDays: 10,
};

export type SourceItem = {
  id: string;
  domain: Domain;
  publisher: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt: string; // YYYY-MM-DD
};

export type FeedReport = { publisher: string; ok: boolean; items: number; ms: number; error?: string };

export type Quarantined = { publisher: string; title: string; url: string; reason: string };

/**
 * Defense layer 1: drop feed items that try to address the AI or the app.
 * Real news almost never contains these phrases; a false positive costs one
 * story, a false negative is still contained by layers 2–4 (prompt boundary,
 * output validation, and code-owned state).
 */
const INJECTION_PATTERNS: [RegExp, string][] = [
  [/\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions?|prompts?|rules|guidelines)\b/i, "instruction override"],
  [/\b(system prompt|developer message|jailbreak|admin mode|developer mode)\b/i, "prompt manipulation"],
  [/\byou are (now )?(an? )?(ai|assistant|language model|chatgpt|gpt)\b/i, "addresses the model"],
  [/\b(set|reset|increase|increment|award|grant|give)\b.{0,40}\b(streak|xp|points|score|mastery)\b/i, "tries to change learner state"],
  [/\bmark\b.{0,60}\b(mastered|earned|complete|completed|strong)\b/i, "tries to change learner state"],
  [/\b(api[_ -]?key|portkey|openai_api_key|secret key|password)\b/i, "asks about secrets"],
  [/<\/?\s*(untrusted_sources|system|instructions|assistant)\b/i, "fake prompt delimiter"],
  [/(^|[\s.;])(system|assistant|developer)\s*:/i, "fake role label"],
  [/\b(learner|user|student)\b.{0,20}\b(has|have|already)\b.{0,20}\b(mastered|earned|completed|learned)\b/i, "claims about learner progress"],
  [/\bskip\b.{0,20}\b(quiz|quizzes|review|lesson)\b/i, "tries to change lesson flow"],
];

export function screenItem(item: Pick<SourceItem, "title" | "snippet">): string | null {
  const text = `${item.title} ${item.snippet}`;
  for (const [re, reason] of INJECTION_PATTERNS) if (re.test(text)) return reason;
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", pound: "\u00a3", euro: "\u20ac",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip markup and control characters, collapse whitespace, cap length. */
export function cleanText(raw: string, max: number): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = decodeEntities(s); // entity-encoded HTML inside RSS descriptions
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
  s = decodeEntities(s);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return s;
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `s-${(h >>> 0).toString(36)}`;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse RSS 2.0 or Atom. Pure, so it can be tested on fixtures. */
export function parseFeed(xml: string, feed: Feed, now: Date = new Date()): SourceItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const oldest = now.getTime() - LIMITS.maxAgeDays * 86_400_000;
  const items: SourceItem[] = [];
  for (const b of blocks) {
    const title = cleanText(tag(b, "title"), LIMITS.titleChars);
    let link = cleanText(tag(b, "link"), 500);
    if (!link) link = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
    link = decodeEntities(link).trim();
    const dateRaw = cleanText(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"), 80);
    const snippet = cleanText(tag(b, "description") || tag(b, "summary") || tag(b, "content"), LIMITS.snippetChars);
    const date = new Date(dateRaw.replace(/\s+EST$/, " -0500").replace(/\s+EDT$/, " -0400"));
    if (!title || !/^https:\/\/[^\s]+$/.test(link) || Number.isNaN(date.getTime())) continue;
    if (date.getTime() < oldest || date.getTime() > now.getTime() + 86_400_000) continue;
    items.push({
      id: hashId(link),
      domain: feed.domain,
      publisher: feed.publisher,
      title,
      snippet,
      url: link,
      publishedAt: isoDay(date),
    });
    if (items.length >= LIMITS.itemsPerFeed) break;
  }
  return items;
}

async function fetchFeed(feed: Feed): Promise<{ items: SourceItem[]; report: FeedReport }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.feedTimeoutMs);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { "User-Agent": "DailySignal/0.2 (educational project; RSS reader)", Accept: "application/rss+xml, application/xml, text/xml" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > LIMITS.maxFeedBytes) throw new Error("feed too large");
    const xml = (await res.text()).slice(0, LIMITS.maxFeedBytes);
    const items = parseFeed(xml, feed);
    return { items, report: { publisher: feed.publisher, ok: true, items: items.length, ms: Date.now() - started } };
  } catch (err) {
    const error = controller.signal.aborted ? "timeout" : err instanceof Error ? err.message : "error";
    return { items: [], report: { publisher: feed.publisher, ok: false, items: 0, ms: Date.now() - started, error } };
  } finally {
    clearTimeout(timer);
  }
}

export type Retrieval = { items: SourceItem[]; reports: FeedReport[]; quarantined?: Quarantined[] };

/** Split items into clean ones and quarantined ones (with reasons). */
export function screenItems(items: SourceItem[]): { clean: SourceItem[]; quarantined: Quarantined[] } {
  const clean: SourceItem[] = [];
  const quarantined: Quarantined[] = [];
  for (const i of items) {
    const reason = screenItem(i);
    if (reason) quarantined.push({ publisher: i.publisher, title: i.title, url: i.url, reason });
    else clean.push(i);
  }
  return { clean, quarantined };
}

/** Fetch all feeds in parallel, screen for injection, de-duplicate, balance and cap per domain. */
export async function retrieveSources(feeds: Feed[] = FEEDS): Promise<Retrieval> {
  const results = await Promise.all(feeds.map(fetchFeed));
  const { clean, quarantined } = screenItems(results.flatMap((r) => r.items));
  return { items: selectItems(clean), reports: results.map((r) => r.report), quarantined };
}

export function selectItems(all: SourceItem[]): SourceItem[] {
  const seen = new Set<string>();
  const out: SourceItem[] = [];
  for (const domain of ["finance", "energy"] as const) {
    // Round-robin across publishers (newest first within each) so one busy feed can't crowd out the rest.
    const byPublisher = new Map<string, SourceItem[]>();
    for (const i of all.filter((x) => x.domain === domain).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      byPublisher.set(i.publisher, [...(byPublisher.get(i.publisher) ?? []), i]);
    }
    const queues = [...byPublisher.values()];
    let taken = 0;
    while (taken < LIMITS.maxItemsPerDomain && queues.some((q) => q.length)) {
      for (const q of queues) {
        const next = q.shift();
        if (next && taken < LIMITS.maxItemsPerDomain) {
          out.push(next);
          taken++;
        }
      }
    }
  }
  return out;
}
