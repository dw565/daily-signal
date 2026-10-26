/** Spend controls for live generation (in-memory, per server process). */

export type LimiterState = { byIp: Map<string, number[]>; byDay: Map<string, number> };

export function allowRun(
  st: LimiterState,
  ip: string,
  now: number,
  opts: { perIpPerHour: number; perDay: number },
): { ok: true } | { ok: false; reason: "rate_limited" | "daily_cap" } {
  const recent = (st.byIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= opts.perIpPerHour) return { ok: false, reason: "rate_limited" };
  const day = new Date(now).toISOString().slice(0, 10);
  if ((st.byDay.get(day) ?? 0) >= opts.perDay) return { ok: false, reason: "daily_cap" };
  st.byIp.set(ip, [...recent, now]);
  st.byDay.set(day, (st.byDay.get(day) ?? 0) + 1);
  return { ok: true };
}
