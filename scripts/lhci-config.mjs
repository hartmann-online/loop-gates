#!/usr/bin/env node
// lhci-config.mjs — erzeugt die Lighthouse-CI-Config (stdout) aus einem Budget-Profil.
// Score-Semantik (ADR-0072): performance = warn · seo/best-practices/accessibility = error.
// Aufruf: node lhci-config.mjs --dist dist --profile profiles/<name>.json > lighthouserc.json
import { readFileSync } from "node:fs";

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const dist = arg("--dist"), profilePath = arg("--profile");
if (!dist || !profilePath) { console.error("Usage: --dist <dir> --profile <json>"); process.exit(2); }
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
const budgets = JSON.parse(readFileSync(profilePath, "utf8")).budgets ?? {};
if (budgets.image_kb !== undefined) {
  assertions["resource-summary:image:size"] = ["error", { maxNumericValue: budgets.image_kb * 1024 }];
}
if (budgets.total_kb !== undefined) {
  assertions["resource-summary:total:size"] = ["error", { maxNumericValue: budgets.total_kb * 1024 }];
}

process.stdout.write(JSON.stringify({
  ci: {
    collect: {
      staticDistDir: dist,
      url: routes.map((r) => `http://localhost/${r.replace(/^\//, "")}`),
      numberOfRuns: 1,
    },
    assert: { assertions },
    upload: { target: "filesystem", outputDir: ".lighthouseci-report" },
  },
}, null, 2));
