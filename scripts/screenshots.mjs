#!/usr/bin/env node
// screenshots.mjs — Playwright-Screenshots der Profil-Routen; Diff gegen baseline/ (warn-only).
// Verhalten: baseline fehlt → Screenshots nach .screenshots/ (Artefakt) + Hinweis, Exit 0.
//            baseline vorhanden → pixelmatch-Diff; Abweichung > threshold_pct → Warnung in
//            $GITHUB_STEP_SUMMARY + Diff-Bild im Artefakt, Exit 0 (der Job ist warn-only).
// Aufruf: node screenshots.mjs --dist dist --profile <json> --baseline baseline
// Benötigt (im Workflow installiert): playwright, pixelmatch, pngjs.
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(join(process.cwd(), "noop.js"));
const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const dist = arg("--dist"), profilePath = arg("--profile"), baselineDir = arg("--baseline") ?? "baseline";
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const cfg = profile.screenshots ?? {};
const routesArg = ((i) => (i > -1 ? process.argv[i + 1] : ""))(process.argv.indexOf("--routes"));
const routes = routesArg.split(",").map((s) => s.trim()).filter(Boolean).length
  ? routesArg.split(",").map((s) => s.trim()).filter(Boolean)
  : (cfg.routes ?? ["/"]);
const threshold = (cfg.threshold_pct ?? 1.0) / 100;
const outDir = ".screenshots";
mkdirSync(outDir, { recursive: true });

const summary = (line) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n"); console.log(line); };
const slug = (r) => (r === "/" ? "home" : r.replace(/^\/|\/$/g, "").replace(/\//g, "_"));

// statischen Server starten (http-server via npx, Port 4173)
const srv = spawn("npx", ["--yes", "http-server", dist, "-p", "4173", "-s"], { stdio: "ignore", detached: true });
await new Promise((r) => setTimeout(r, 3000));

try {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let warned = false;
  for (const route of routes) {
    const file = join(outDir, `${slug(route)}.png`);
    await page.goto(`http://localhost:4173${route}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: file, fullPage: true });
    const base = join(baselineDir, `${slug(route)}.png`);
    if (!existsSync(base)) { summary(`SCREENSHOTS: ${route} — keine Baseline (${base}); aktueller Stand im Artefakt.`); continue; }
    const { PNG } = require("pngjs");
    const pixelmatch = (require("pixelmatch").default ?? require("pixelmatch"));
    const a = PNG.sync.read(readFileSync(base)), b = PNG.sync.read(readFileSync(file));
    if (a.width !== b.width || a.height !== b.height) { summary(`⚠️ SCREENSHOTS: ${route} — Dimensionen weichen ab (${a.width}x${a.height} → ${b.width}x${b.height}).`); warned = true; continue; }
    const diff = new PNG({ width: a.width, height: a.height });
    const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
    const pct = n / (a.width * a.height);
    if (pct > threshold) {
      writeFileSync(join(outDir, `${slug(route)}.diff.png`), PNG.sync.write(diff));
      summary(`⚠️ SCREENSHOTS: ${route} — ${(pct * 100).toFixed(2)} % Abweichung (> ${(threshold * 100).toFixed(1)} %); Diff im Artefakt. Baseline-Update = bewusster Commit nach Taste-Gate.`);
      warned = true;
    } else {
      summary(`SCREENSHOTS: ${route} — ok (${(pct * 100).toFixed(2)} % Abweichung).`);
    }
  }
  await browser.close();
  if (!warned) summary("SCREENSHOTS: alle Routen innerhalb der Schwelle.");
} finally {
  try { process.kill(-srv.pid); } catch { /* best effort */ }
}
