#!/usr/bin/env node
// check-assets.mjs — deterministische Gewichts-Budgets über das dist/ (blockierend).
// Klassen: image (png/jpg/jpeg/webp/avif/gif/svg) · font (woff/woff2/ttf/otf) · js (js/mjs/cjs).
// Budgets (KB, Summe je Klasse über das gesamte dist) aus dem Profil; js_kb=0 = Zero-JS (ADR-0081).
// Aufruf: node check-assets.mjs --dist dist --profile profiles/<name>.json · Exit 0/1/2.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const dist = arg("--dist"), profilePath = arg("--profile");
if (!dist || !profilePath) { console.error("Usage: --dist <dir> --profile <json>"); process.exit(2); }
const budgets = JSON.parse(readFileSync(profilePath, "utf8")).budgets ?? {};

const CLASSES = {
  image: new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg"]),
  font:  new Set([".woff", ".woff2", ".ttf", ".otf"]),
  js:    new Set([".js", ".mjs", ".cjs"]),
};
const sums = { total: 0, image: 0, font: 0, js: 0 };
const offenders = { image: [], font: [], js: [] };
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    sums.total += st.size;
    const ext = extname(e).toLowerCase();
    for (const [cls, exts] of Object.entries(CLASSES)) {
      if (exts.has(ext)) { sums[cls] += st.size; offenders[cls].push(`${p} (${Math.round(st.size / 1024)} KB)`); }
    }
  }
})(dist);

// SEMANTIK (v1.2.0): dist-Summen nur für js (Zero-JS-Doktrin: was im dist liegt, wird ausgeliefert)
// und font (klein, nicht variant-multipliziert). image_kb/total_kb messen SEITENGEWICHT und laufen
// als per-Route-Lighthouse-Resource-Budgets (lhci-config.mjs) — eine dist-Summe wäre bei
// Responsive-Bild-Pipelines (n Varianten je Bild, Besucher lädt eine) strukturell falsch.
let findings = 0;
for (const [key, cls] of [["font_kb", "font"], ["js_kb", "js"]]) {
  if (budgets[key] === undefined) continue;
  const kb = Math.round(sums[cls] / 1024);
  if (kb > budgets[key]) {
    console.error(`ASSETS: ${cls} = ${kb} KB > Budget ${key}=${budgets[key]} KB.${offenders[cls]?.length ? " Dateien: " + offenders[cls].join(", ") : ""}`);
    findings++;
  } else {
    console.log(`ASSETS: ${cls} = ${kb} KB ≤ ${budgets[key]} KB ok.`);
  }
}
process.exit(findings ? 1 : 0);
