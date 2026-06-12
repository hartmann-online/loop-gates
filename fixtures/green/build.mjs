// Fixture-Build: site/ → dist/ (statisch, kein Framework — der Gate-Vertrag ist build-agnostisch).
import { cpSync, rmSync } from "node:fs";
rmSync("dist", { recursive: true, force: true });
cpSync("site", "dist", { recursive: true });
console.log("fixture build: site/ → dist/");
