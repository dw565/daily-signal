#!/usr/bin/env node
/**
 * Builds the self-contained submission files report.html and slides.html from
 * docs/*.src.html: embeds screenshots as data URIs and fills values from
 * evidence/ so the documents can't drift from the recorded runs.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docs = path.join(root, "docs");
const cfg = JSON.parse(fs.readFileSync(path.join(docs, "config.json"), "utf8"));
const traced = JSON.parse(fs.readFileSync(path.join(root, "evidence", "traced-run.json"), "utf8"));
const safety = fs.readFileSync(path.join(docs, "safety-test-output.txt"), "utf8").replace(/\s+$/, "");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const values = {
  REPO_URL: cfg.repoUrl,
  "trace.runId": traced.trace.runId,
  "trace.startedAt": traced.trace.startedAt.replace("T", " ").replace(/\.\d+Z$/, ""),
  safety_output: esc(safety).replace(/✓/g, '<span class="ok">✓</span>'),
};

function build(src, out) {
  let html = fs.readFileSync(path.join(docs, src), "utf8");
  html = html.replace(/\{\{img:([\w-]+)\}\}/g, (_, name) => {
    const file = path.join(docs, "screenshots", `${name}.jpg`);
    if (!fs.existsSync(file)) throw new Error(`Missing screenshot ${name}`);
    return `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
  });
  html = html.replace(/\{\{([\w.]+)\}\}/g, (m, key) => (key in values ? values[key] : m));
  const left = html.match(/\{\{[^}]+\}\}/g);
  if (left) console.warn(`  ${out}: unfilled placeholders: ${[...new Set(left)].join(", ")}`);
  fs.writeFileSync(path.join(root, out), html);
  console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);
}

build("report.src.html", "report.html");
if (fs.existsSync(path.join(docs, "slides.src.html"))) build("slides.src.html", "slides.html");
