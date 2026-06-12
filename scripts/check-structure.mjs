#!/usr/bin/env node
// check-structure.mjs — Pflicht-Meta + h1-Regel über alle dist/**/*.html (blockierend).
// Aufruf: node check-structure.mjs --dist dist --profile profiles/<name>.json
// Exit 0 = ok · 1 = Befund(e) · 2 = Bedienfehler. Dep-frei (Regex-Parsing, bewusst v1-pragmatisch).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const dist = arg("--dist"), profilePath = arg("--profile");
if (!dist || !profilePath) { console.error("Usage: --dist <dir> --profile <json>"); process.exit(2); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const req = profile.structure?.require ?? [];
const h1PerPage = profile.structure?.h1_per_page ?? null;

const htmlFiles = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith(".html")) htmlFiles.push(p);
  }
})(dist);
if (htmlFiles.length === 0) { console.error(`STRUCTURE: keine HTML-Dateien in ${dist}`); process.exit(1); }

const CHECKS = {
  title:            (h) => /<title>\s*\S[^<]*<\/title>/i.test(h),
  meta_description: (h) => /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(h) || /<meta[^>]+content=["'][^"']+["'][^>]+name=["']description["']/i.test(h),
  og_image:         (h) => /<meta[^>]+property=["']og:image["'][^>]+content=["'][^"']+["']/i.test(h) || /<meta[^>]+content=["'][^"']+["'][^>]+property=["']og:image["']/i.test(h),
  canonical:        (h) => /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']+["']/i.test(h) || /<link[^>]+href=["'][^"']+["'][^>]+rel=["']canonical["']/i.test(h),
  lang:             (h) => /<html[^>]+lang=["'][a-zA-Z-]+["']/i.test(h),
};

let findings = 0;
for (const f of htmlFiles) {
  const html = readFileSync(f, "utf8");
  for (const r of req) {
    const check = CHECKS[r];
    if (!check) { console.error(`STRUCTURE: unbekanntes require-Kriterium '${r}' im Profil`); findings++; continue; }
    if (!check(html)) { console.error(`STRUCTURE: ${f}: '${r}' fehlt (Profil ${profile.name} verlangt: ${req.join(", ")})`); findings++; }
  }
  if (h1PerPage !== null) {
    const n = (html.match(/<h1[\s>]/gi) ?? []).length;
    if (n !== h1PerPage) { console.error(`STRUCTURE: ${f}: ${n}×<h1>, Profil verlangt genau ${h1PerPage}`); findings++; }
  }
}
if (findings) { console.error(`STRUCTURE: ${findings} Befund(e) in ${htmlFiles.length} Seiten.`); process.exit(1); }
console.log(`STRUCTURE: ok (${htmlFiles.length} Seiten, require: ${req.join(", ") || "—"}, h1=${h1PerPage ?? "—"}).`);
