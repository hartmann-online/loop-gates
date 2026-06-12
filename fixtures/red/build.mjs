// Fixture-Build (rot): site/ → dist/ + erzeugt eine JS-Datei (verletzt js_kb=0, ADR-0081).
import { cpSync, rmSync, writeFileSync } from "node:fs";
rmSync("dist", { recursive: true, force: true });
cpSync("site", "dist", { recursive: true });
writeFileSync("dist/app.js", "// verletzt das Zero-JS-Budget\n" + "console.log('x');\n".repeat(200));
console.log("fixture build (red): site/ → dist/ (+app.js)");
