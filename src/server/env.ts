import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Load `.env` from the repo folder first, then the folder above it (the
 * grading layout). Existing process variables are never overwritten, and
 * values are never logged.
 */
let loaded = false;

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

export function loadEnv(): { files: string[] } {
  const files: string[] = [];
  if (loaded) return { files };
  loaded = true;
  const root = process.cwd();
  for (const file of [path.join(root, ".env"), path.join(root, "..", ".env")]) {
    try {
      const vars = parseEnv(fs.readFileSync(file, "utf8"));
      for (const [k, v] of Object.entries(vars)) if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
      files.push(file);
    } catch {
      // missing file is fine
    }
  }
  return { files };
}

export type ProviderConfig = {
  provider: "portkey" | "openai";
  baseUrl: string;
  model: string;
  apiKey: string;
};

/** Course key (Portkey, gpt-6-luna) first; personal OpenAI key second. */
export function providerConfig(): ProviderConfig | null {
  loadEnv();
  const portkey = process.env.PORTKEY_API_KEY?.trim();
  if (portkey) {
    return {
      provider: "portkey",
      baseUrl: "https://api.portkey.ai/v1",
      model: process.env.DAILY_SIGNAL_MODEL?.trim() || "gpt-6-luna",
      apiKey: portkey,
    };
  }
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai) {
    return {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: process.env.DAILY_SIGNAL_MODEL?.trim() || "gpt-6-luna",
      apiKey: openai,
    };
  }
  return null;
}

export function forceDemo(): boolean {
  loadEnv();
  return process.env.DAILY_SIGNAL_MODE?.trim().toLowerCase() === "demo";
}
