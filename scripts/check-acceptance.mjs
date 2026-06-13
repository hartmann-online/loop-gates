#!/usr/bin/env node
// check-acceptance.mjs — Prüft .github/acceptance.yml-Assertions (lighthouse/shell/structure).
// Aufruf: node check-acceptance.mjs [--acceptance .github/acceptance.yml] [--dist dist] [--lh-dir .lighthouseci-report]
// Exit 0 = ok oder kein acceptance.yml · 1 = Befund(e) · 2 = Bedienfehler. Dep-frei (bewusst v1-pragmatisch).
//
// Format .github/acceptance.yml:
//   assertions:
//     - type: lighthouse
//       metric: performance        # performance|accessibility|seo|best-practices|fcp|lcp|cls|tbt
//       op: ">=" (default)        # >=|>|<=|<|==
//       value: 0.95               # 0.0–1.0 für Scores, ms für Timing
//       routes: ["/"]             # optional; ohne: alle LH-Reports
//       description: "Perf ≥ 95" # optionaler Label
//     - type: shell
//       command: "grep -rq 'font-display: swap' dist/"
//       description: "Font-Display-Swap vorhanden"
//     - type: structure
//       path: "index.html"         # relativ zu --dist
//       exists: true               # optional (default: true)
//       contains: "og:image"       # optional Substring-Prüfung
//       description: "OG-Image in Index"

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const acceptancePath = arg("--acceptance") ?? ".github/acceptance.yml";
const distDir = arg("--dist") ?? "dist";
const lhDir = arg("--lh-dir") ?? ".lighthouseci-report";

if (!existsSync(acceptancePath)) {
  console.log("ACCEPTANCE: keine acceptance.yml — skip.");
  process.exit(0);
}

// Dep-freier YAML-Parser für das eingeschränkte acceptance.yml-Format.
function parseYaml(text) {
  const result = {};
  let currentList = null;
  let currentItem = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      const m = trimmed.match(/^([\w-]+):\s*$/);
      if (m) { result[m[1]] = []; currentList = result[m[1]]; currentItem = null; }
    } else if (indent === 2 && trimmed.startsWith("- ")) {
      currentItem = {};
      if (currentList) currentList.push(currentItem);
      const kv = trimmed.slice(2).match(/^([\w-]+):\s*(.*)$/);
      if (kv) currentItem[kv[1]] = scalar(kv[2]);
    } else if (indent >= 4 && currentItem) {
      const kv = trimmed.match(/^([\w-]+):\s*(.*)$/);
      if (kv) currentItem[kv[1]] = scalar(kv[2]);
    }
  }
  return result;
}

function scalar(s) {
  s = s.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (/^\d+\.\d+$/.test(s)) return parseFloat(s);
  if (s.startsWith("[") && s.endsWith("]"))
    return s.slice(1, -1).split(",").map(x => scalar(x.trim())).filter(x => x !== "");
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1);
  return s;
}

let parsed;
try { parsed = parseYaml(readFileSync(acceptancePath, "utf8")); }
catch (e) { console.error(`ACCEPTANCE: Fehler beim Parsen von ${acceptancePath}: ${e.message}`); process.exit(2); }

const assertions = parsed.assertions ?? [];
if (!assertions.length) { console.log("ACCEPTANCE: keine Assertions definiert — skip."); process.exit(0); }

// LH-Reports laden (.lighthouseci-report/lhr-*.json, Ausgabe von lhci-config.mjs outputDir)
const lhReports = [];
if (existsSync(lhDir)) {
  for (const f of readdirSync(lhDir)) {
    if (f.startsWith("lhr-") && f.endsWith(".json")) {
      try { lhReports.push(JSON.parse(readFileSync(join(lhDir, f), "utf8"))); } catch {}
    }
  }
}

const OPS = {
  ">=": (a, b) => a >= b, ">": (a, b) => a > b,
  "<=": (a, b) => a <= b, "<":  (a, b) => a < b,
  "=": (a, b) => a === b, "==": (a, b) => a === b,
};
const METRICS = {
  performance:       r => r.categories?.performance?.score,
  accessibility:     r => r.categories?.accessibility?.score,
  seo:               r => r.categories?.seo?.score,
  "best-practices":  r => r.categories?.["best-practices"]?.score,
  fcp:  r => r.audits?.["first-contentful-paint"]?.numericValue,
  lcp:  r => r.audits?.["largest-contentful-paint"]?.numericValue,
  cls:  r => r.audits?.["cumulative-layout-shift"]?.numericValue,
  tbt:  r => r.audits?.["total-blocking-time"]?.numericValue,
};

let fails = 0, passes = 0;

for (const a of assertions) {
  const label = a.description || `${a.type}:${a.metric ?? a.command ?? a.path ?? "?"}`;

  if (a.type === "lighthouse") {
    if (!lhReports.length) {
      console.warn(`ACCEPTANCE SKIP: ${label} — keine LH-Reports in ${lhDir}`);
      continue;
    }
    const getter = METRICS[a.metric];
    if (!getter) { console.error(`ACCEPTANCE ERROR: unbekannte metric '${a.metric}'`); fails++; continue; }
    const op = OPS[a.op ?? ">="];
    if (!op) { console.error(`ACCEPTANCE ERROR: unbekannter op '${a.op}'`); fails++; continue; }
    const routes = a.routes ? (Array.isArray(a.routes) ? a.routes : [a.routes]) : null;
    const relevant = routes
      ? lhReports.filter(r => routes.some(rt =>
          (r.requestedUrl ?? "").endsWith(rt) || (r.finalUrl ?? "").endsWith(rt)))
      : lhReports;
    if (!relevant.length) {
      console.warn(`ACCEPTANCE SKIP: ${label} — keine Reports für routes ${JSON.stringify(routes)}`);
      continue;
    }
    for (const rpt of relevant) {
      const val = getter(rpt);
      const url = rpt.requestedUrl ?? rpt.finalUrl ?? "?";
      if (val == null) { console.warn(`ACCEPTANCE SKIP: ${label} — metric nicht im Report (${url})`); continue; }
      if (op(val, a.value)) {
        console.log(`ACCEPTANCE ok: ${label} — ${a.metric}=${val} ${a.op ?? ">="}${a.value} (${url})`);
        passes++;
      } else {
        console.error(`ACCEPTANCE FAIL: ${label} — ${a.metric}=${val} nicht ${a.op ?? ">="}${a.value} (${url})`);
        fails++;
      }
    }

  } else if (a.type === "shell") {
    if (!a.command) { console.error("ACCEPTANCE ERROR: shell-Assertion ohne command"); fails++; continue; }
    try {
      execSync(a.command, { stdio: "pipe" });
      console.log(`ACCEPTANCE ok: ${label}`);
      passes++;
    } catch {
      console.error(`ACCEPTANCE FAIL: ${label} — Command fehlgeschlagen: ${a.command}`);
      fails++;
    }

  } else if (a.type === "structure") {
    if (!a.path) { console.error("ACCEPTANCE ERROR: structure-Assertion ohne path"); fails++; continue; }
    const fullPath = join(distDir, a.path);
    const exists = existsSync(fullPath);
    const shouldExist = a.exists !== false;
    if (shouldExist !== exists) {
      console.error(`ACCEPTANCE FAIL: ${label} — ${fullPath} ${shouldExist ? "nicht vorhanden" : "sollte nicht existieren"}`);
      fails++; continue;
    }
    if (a.contains && exists) {
      const content = readFileSync(fullPath, "utf8");
      if (!content.includes(a.contains)) {
        console.error(`ACCEPTANCE FAIL: ${label} — '${a.contains}' nicht in ${fullPath}`);
        fails++; continue;
      }
    }
    console.log(`ACCEPTANCE ok: ${label}`);
    passes++;

  } else {
    console.error(`ACCEPTANCE ERROR: unbekannter Typ '${a.type}'`);
    fails++;
  }
}

console.log(`\nACCEPTANCE: ${passes} ok · ${fails} Befund(e).`);
process.exit(fails > 0 ? 1 : 0);
