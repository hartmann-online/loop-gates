# loop-gates

Zentrale Quality-Gates des Produktions-Loops (ADR-0150) — **Reusable Workflows + deklarative
Budget-Profile**. Public, damit alle drei GitHub-Owner (hartmann-online · kultmeister ·
narrawise-io) dieselben Gates rufen können. **Enthält bewusst keine Secrets und keine
Infra-Konfiguration.** Spec: `jhonas-nexus/knowledge/workflows/produktions-loop/`.

## Nutzung (Hook im Code-Repo, ~10 Zeilen)

```yaml
name: quality
on: { pull_request: {} }
permissions: { contents: read, pull-requests: write }
jobs:
  quality:
    uses: hartmann-online/loop-gates/.github/workflows/edition-quality.yml@v1
    with:
      profile: edition-handcrafted   # foundation | handcrafted | masterpiece
```

Required Check im Caller-Ruleset: **`quality / quality`** (blockierend). Der Job
`quality / screenshots` ist warn-only (Artefakt + Step-Summary; Baseline-Update = bewusster Commit
nach Taste-Gate, Baselines liegen im Caller unter `baseline/`).

## Fehlersemantik

Blockierend (fail-closed): Build · Structure (Pflicht-Meta/h1; 404-Seiten sind von canonical/og
ausgenommen) · Assets (dist-Summen für `js_kb`/`font_kb`; `image_kb`/`total_kb` = **Seitengewicht
pro Route** via Lighthouse resource-summary — dist-Summen wären bei Responsive-Bild-Pipelines
falsch) · interne Links · Lighthouse-Scores **SEO/Best-Practices/A11y**.
Warn-only: Lighthouse-**Performance**-Score (ADR-0072 — flaky; der Performance-Anspruch steckt
deterministisch in den Gewichts-Budgets) · Screenshots. Jede blockierende Meldung nennt den
Profilwert, gegen den verglichen wurde — Agenten iterieren gegen diese Logs.

## Profile

`profiles/<name>.json`, validiert gegen `profiles/profile.schema.json` (Selbsttest). Drei
Editions-Tiers (foundation/handcrafted/masterpiece) + `fixture` (nur Selbsttest). Schwellen-Pflege:
bis Q-26 von Hand, Kalibrierung gegen die realen Editionen ist Slice 2.

## Versionierung & Release (Tag-Prozess)

- Caller pinnen **`@v1`** (Major-Tag). Härtere Variante je Repo: SHA-Pin + Renovate.
- Release: PR grün (Selbsttest) → squash-merge → `git tag v1.x.y && git tag -f v1 && git push --tags --force`
  → Release-Note (eine Zeile je Änderung). Rollback = `git tag -f v1 <letzter-guter-sha>`.
- Breaking Change ⇒ `v2` + Migrationsnotiz hier im README.

## Selbsttest (Gate-Efficacy, ADR-0123)

`selftest.yml` beweist je PR: Profile schema-valide · `fixtures/green` läuft **grün** durch das
echte Gate (lokaler `workflow_call` mit `gates-ref`=PR-SHA) · `fixtures/red` wird von jedem
blockierenden Eigen-Check (structure/assets/links) **rot** gefangen. Lighthouse-/axe-Rot-Fälle sind
bewusst nicht fixture-getestet (Fremd-Tools, Laufzeit/Kosten).

## Bewusste v1-Entscheidungen (Abweichungen zur Spec, semantik-erhaltend)

- **Ein blockierender Job** statt fünf: ein Required Check, sequentielle agent-lesbare Logs, kein
  Artefakt-Geschiebe. Fehlersemantik unverändert.
- **linkinator statt lychee** (npm-nativ, kein Binary-Download); externe Links werden im PR-Pfad
  übersprungen (`--skip ^https?://`) — externe Link-Prüfung gehört in den Content-Check/Cron.
- **a11y**: blockierend via Lighthouse-Accessibility-Score; ein dediziertes axe-Gate folgt bei
  Bedarf (Kalibrierung Slice 2).
- **npm-Pakete via npx unpinned** (erste Iteration); nach grünem Flotten-Rollout werden die
  aufgelösten Versionen gepinnt (Follow-up im Selbsttest-Log dokumentiert).
- **Screenshot-Warnung** läuft über Step-Summary + Artefakt statt PR-Kommentar (keine zusätzlichen
  Permissions nötig).

## Sicherheit

Public Repo: Branch-Protection (PR + Owner-Review + grüner Selbsttest), keine Force-Pushes; nur
First-Party-Actions (`actions/*`); keine Secrets — Caller reichen keine Secrets an diese Workflows.
