#!/usr/bin/env node
// Bundle size check: bundles `export * from` each entry point of dist/ with esbuild (tree-shaken,
// minified), gzips it and fails when an entry is over its budget in size-budgets.json.
// Usage: npm run build && node scripts/size.mjs
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const budgets = JSON.parse(readFileSync(join(ROOT, 'scripts', 'size-budgets.json'), 'utf8'));

const rows = [];
for (const [key, entry] of Object.entries(pkg.exports)) {
  const name = pkg.name + key.slice(1);
  const result = await build({
    stdin: { contents: `export * from ${JSON.stringify(entry.import)};`, resolveDir: ROOT },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'error',
  });
  const gzip = gzipSync(result.outputFiles[0].contents, { level: 9 }).length;
  const budget = budgets[name];
  rows.push({ name, gzip, budget, ok: budget !== undefined && gzip <= budget });
}

for (const { name, gzip, budget, ok } of rows) {
  const limit = budget === undefined ? 'no budget' : `${budget} B`;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(24)} ${String(gzip).padStart(7)} B gzip  (${limit})`,
  );
}
const failed = rows.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(
    `\n${failed.length} entry point(s) over budget or without one. Set budgets about 20% over the current size in scripts/size-budgets.json.`,
  );
  process.exit(1);
}
