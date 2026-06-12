#!/usr/bin/env node
// lhci-config.mjs — erzeugt die Lighthouse-CI-Config (stdout) aus einem Budget-Profil.
// Score-Semantik (ADR-0072): performance = warn · seo/best-practices/accessibility = error.
// Zwei Modi:
//   dist (PR-Gate):    node lhci-config.mjs --dist dist --profile profiles/<name>.json
//   prod (Fleet-Cron): node lhci-config.mjs --base-url https://example.com --profile profiles/<name>.json
// Im prod-Modus pruefen zusaetzlich script/font-resource-summary die js_kb/font_kb-Budgets:
// check-assets.mjs misst die nur als dist-Summe — ohne dist muessen sie aus dem realen
// Page-Load kommen (ADR-0150 Slice 4, Fleet-Cron).
import { readFileSync } from "node:fs";

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const dist = arg("--dist"), profilePath = arg("--profile"), baseUrl = arg("--base-url");
if ((!dist && !baseUrl) || (dist && baseUrl) || !profilePath) {
  console.error("Usage: (--dist <dir> | --base-url <url>, genau eines) --profile <json>"); process.exit(2);
}
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const lh = profile.lighthouse ?? {};
const routesArg = (arg("--routes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const routes = routesArg.length ? routesArg : (profile.routes?.length ? profile.routes : ["/"]);

const level = (cat) => (cat === "performance" ? "warn" : "error");
const assertions = {};
for (const [cat, min] of Object.entries(lh)) {
  assertions[`categories:${cat}`] = [level(cat), { minScore: min / 100 }];
}
// Seitengewicht pro Route (blockierend, deterministisch aus dem realen Page-Load):
// image_kb/total_kb aus dem Profil → Lighthouse resource-summary (v1.2.0; check-assets misst
// nur noch js/font als dist-Summe — Responsive-Pipelines machen dist-Summen für Bilder falsch).
const budgets = profile.budgets ?? {};
if (budgets.image_kb !== undefined) {
  assertions["resource-summary:image:size"] = ["error", { maxNumericValue: budgets.image_kb * 1024 }];
}
if (budgets.total_kb !== undefined) {
  assertions["resource-summary:total:size"] = ["error", { maxNumericValue: budgets.total_kb * 1024 }];
}
// Prod-Modus: js/font-Budgets aus dem Page-Load (im dist-Modus deckt check-assets.mjs das ab).
if (baseUrl) {
  if (budgets.js_kb !== undefined) {
    assertions["resource-summary:script:size"] = ["error", { maxNumericValue: budgets.js_kb * 1024 }];
  }
  if (budgets.font_kb !== undefined) {
    assertions["resource-summary:font:size"] = ["error", { maxNumericValue: budgets.font_kb * 1024 }];
  }
}

const urls = baseUrl
  ? routes.map((r) => new URL(r, baseUrl).href)
  : routes.map((r) => `http://localhost/${r.replace(/^\//, "")}`);

const blocked = (arg("--blocked") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
process.stdout.write(JSON.stringify({
  ci: {
    collect: {
      ...(baseUrl ? {} : { staticDistDir: dist }),
      url: urls,
      numberOfRuns: 1,
      ...(blocked.length ? { settings: { blockedUrlPatterns: blocked } } : {}),
    },
    assert: { assertions },
    upload: { target: "filesystem", outputDir: ".lighthouseci-report" },
  },
}, null, 2));
