/**
 * Unit prices used for cost estimates. Source: OpenAI API pricing page,
 * https://developers.openai.com/api/docs/pricing (Standard tier, short context
 * ≤272K input), retrieved 2026-10-25. Calls go through the course Portkey
 * gateway, whose billing we can't see — so these are list-price estimates.
 * Reasoning tokens are billed as output and are already inside outputTokens.
 */
export const PRICING = {
  model: "gpt-6-luna",
  source: "https://developers.openai.com/api/docs/pricing",
  retrieved: "2026-10-25",
  tier: "Standard",
  perMillion: { input: 0.1, cachedInput: 0.01, output: 0.5 },
} as const;

export type UsageLike = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
};

/** USD cost of one call/run. `inputTokens` includes cached tokens, which are billed at the cached rate. */
export function costUsd(u: UsageLike): number | null {
  if (u.inputTokens === null || u.outputTokens === null) return null;
  const cached = u.cachedInputTokens ?? 0;
  const p = PRICING.perMillion;
  return ((u.inputTokens - cached) * p.input + cached * p.cachedInput + u.outputTokens * p.output) / 1_000_000;
}
