import type { Lesson, Source } from "@/lib/schema";

export function shortDate(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Live vs. sample must be unmistakable. */
export function ModeBadge({ lesson }: { lesson: Lesson }) {
  if (lesson.mode === "live") {
    const at = new Date(lesson.generatedAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return (
      <span className="badge badge-live">
        <span className="dot" /> Live · generated {at}
      </span>
    );
  }
  const dates = lesson.sources.map((s) => s.publishedAt).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const range =
    first === last
      ? shortDate(first)
      : sameMonth
        ? `${shortDate(first).replace(/, \d{4}$/, "")}–${Number(last.slice(8))}, ${last.slice(0, 4)}`
        : `${shortDate(first).replace(/, \d{4}$/, "")} – ${shortDate(last)}`;
  return (
    <span className="badge badge-demo" title="Bundled sample lesson. Not generated today.">
      <span className="dot" /> Sample lesson · news from {range}
    </span>
  );
}

export function SourceChip({ source }: { source: Source }) {
  return (
    <a className="source-chip" href={source.url} target="_blank" rel="noopener noreferrer nofollow">
      {source.publisher} · {shortDate(source.publishedAt)} ↗
    </a>
  );
}
