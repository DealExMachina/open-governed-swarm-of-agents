#!/usr/bin/env tsx
/**
 * Guard demo static UI assets against the split-refactor corruption
 * (template-literal tail leaked into demo/ui/index.html).
 *
 * Run: pnpm run check:demo-ui
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const UI_DIR = join(process.cwd(), "demo", "ui");
const INDEX_FORBIDDEN = [
  /const\s+DEMO_/,
  /DEMO_MA_VIEW_HTML/,
  /<\/?html>`;/,
];
const MA_VIEW_FORBIDDEN = [/const\s+DEMO_/, /DEMO_MA_VIEW_HTML/, /<\/?html>`;/];

let failed = false;

function checkHtml(name: string, forbidden: RegExp[]): void {
  const path = join(UI_DIR, name);
  const text = readFileSync(path, "utf-8");
  const doctypeCount = (text.match(/<!DOCTYPE html>/gi) ?? []).length;
  if (doctypeCount !== 1) {
    console.error(`${path}: expected exactly one <!DOCTYPE html>, found ${doctypeCount}`);
    failed = true;
  }
  if (!text.trimEnd().endsWith("</html>")) {
    console.error(`${path}: must end with </html>`);
    failed = true;
  }
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      console.error(`${path}: forbidden pattern ${pattern}`);
      failed = true;
    }
  }
}

checkHtml("index.html", INDEX_FORBIDDEN);
checkHtml("ma-view.html", MA_VIEW_FORBIDDEN);

const demoServer = readFileSync(join(process.cwd(), "demo", "demo-server.ts"), "utf-8");
if (!demoServer.includes("${MA_VIEW_DOC_COUNT}")) {
  console.error("demo/demo-server.ts must substitute ${MA_VIEW_DOC_COUNT} for ma-view.html");
  failed = true;
}

const demoRoutes = readFileSync(join(process.cwd(), "demo", "server", "routes.ts"), "utf-8");
if (/import\(["']\.\.\/src\//.test(demoRoutes)) {
  console.error("demo/server/routes.ts must import repo src via ../../src/, not ../src/");
  failed = true;
}
if (!demoRoutes.includes("${FEED_URL}/pending")) {
  console.error("demo/server/routes.ts must proxy /api/pending through FEED_URL");
  failed = true;
}

if (failed) process.exit(1);
console.log("Demo UI assets OK");
