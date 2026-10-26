import "server-only";
import type { ProviderConfig } from "./env";

export type Usage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
};

export type ModelResult = {
  text: string;
  usage: Usage;
  latencyMs: number;
  model: string;
  /** Provider response id (distinct per real generation). */
  responseId: string | null;
  /** Gateway cache status header if the gateway sends one (e.g. Portkey "HIT"/"MISS"). */
  gatewayCache: string | null;
};

export class ModelError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/**
 * One call to an OpenAI-compatible Responses endpoint with strict JSON-schema
 * output. Usage fields are reported as returned by the provider — null when
 * absent, never estimated.
 */
export async function callModel(
  cfg: ProviderConfig,
  opts: {
    instructions: string;
    /** `shared` is identical for every learner today and gets an explicit prompt-cache breakpoint. */
    input: string | { shared: string; personal: string };
    schemaName: string;
    schema: object;
    timeoutMs: number;
    forceRefresh?: boolean;
  },
): Promise<ModelResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        ...(cfg.provider === "portkey" ? { "x-portkey-api-key": cfg.apiKey } : {}),
        ...(cfg.provider === "portkey" && opts.forceRefresh ? { "x-portkey-cache-force-refresh": "true" } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        instructions: opts.instructions,
        input:
          typeof opts.input === "string"
            ? opts.input
            : [
                {
                  role: "user",
                  content: [{ type: "input_text", text: opts.input.shared, prompt_cache_breakpoint: { mode: "explicit" } }],
                },
                { role: "user", content: [{ type: "input_text", text: opts.input.personal }] },
              ],
        text: { format: { type: "json_schema", name: opts.schemaName, strict: true, schema: opts.schema } },
      }),
    });
  } catch (err) {
    throw new ModelError(controller.signal.aborted ? `Model call timed out after ${opts.timeoutMs} ms` : "Model endpoint unreachable");
  } finally {
    clearTimeout(timer);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Pass through the provider's message (no headers/keys), truncated.
    const msg = typeof body?.error?.message === "string" ? body.error.message.slice(0, 200) : `HTTP ${res.status}`;
    throw new ModelError(`Model request failed: ${msg}`, res.status);
  }

  let text = typeof body.output_text === "string" ? body.output_text : "";
  if (!text && Array.isArray(body.output)) {
    for (const item of body.output) {
      for (const c of item?.content ?? []) if (c?.type === "output_text" && typeof c.text === "string") text += c.text;
    }
  }
  const u = body.usage ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    text,
    latencyMs: Date.now() - started,
    model: typeof body.model === "string" ? body.model : cfg.model,
    responseId: typeof body.id === "string" ? body.id : null,
    gatewayCache: res.headers.get("x-portkey-cache-status"),
    usage: {
      inputTokens: num(u.input_tokens),
      cachedInputTokens: num(u.input_tokens_details?.cached_tokens),
      outputTokens: num(u.output_tokens),
      reasoningTokens: num(u.output_tokens_details?.reasoning_tokens),
    },
  };
}
