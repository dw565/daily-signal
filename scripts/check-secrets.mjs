#!/usr/bin/env node
/**
 * Secret-leak check. Reads secret values from .env (repo folder, then the
 * folder above) and searches for them in: git-tracked files, the built client
 * bundle (.next/static), run traces, evidence and server logs.
 * Prints only file counts and match counts — never the values.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const secrets = new Map(); // name -> value
for (const file of [path.join(root, ".env"), path.join(root, "..", ".env")]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (v.length >= 8 && !secrets.has(m[1])) secrets.set(m[1], v);
  }
}
if (!secrets.size) {
  console.log("No secret values found in .env files — nothing to check.");
  process.exit(0);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const tracked = execSync("git ls-files -z", { cwd: root }).toString().split("\0").filter(Boolean).map((f) => path.join(root, f));
const groups = {
  "git-tracked files": tracked,
  "client bundle (.next/static)": walk(path.join(root, ".next", "static")),
  "run traces (runs/)": walk(path.join(root, "runs")),
  "evidence/": walk(path.join(root, "evidence")),
  "server lesson cache (.cache/)": walk(path.join(root, ".cache")),
  "logs (*.log)": walk(root).filter((f) => f.endsWith(".log") && !f.includes("node_modules")),
};

let leaks = 0;
for (const [label, files] of Object.entries(groups)) {
  let hits = 0;
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const [name, value] of secrets) {
      if (text.includes(value)) {
        hits++;
        console.log(`  LEAK: ${name} found in ${path.relative(root, f)}`);
      }
    }
  }
  leaks += hits;
  console.log(`${hits ? "✗" : "✓"} ${label}: ${files.length} files scanned, ${hits} secret matches`);
}
console.log(`\nChecked ${secrets.size} secret value(s) [${[...secrets.keys()].join(", ")}]. ${leaks ? "LEAKS FOUND" : "No leaks."}`);
process.exit(leaks ? 1 : 0);
