#!/usr/bin/env node
// Checks the packed npm tarball: publint, attw, and an install-and-import smoke test of every export.
// Usage: npm run build && node scripts/check-package.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const tmp = mkdtempSync(join(tmpdir(), 'tsentials-pack-'));

try {
  const [{ filename }] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', tmp], { cwd: ROOT, encoding: 'utf8' }),
  );
  const tarball = join(tmp, filename);

  run('npx', ['--no-install', 'publint', 'run', '--strict', tarball]);
  run('npx', ['--no-install', 'attw', tarball, '--profile', 'esm-only']);

  const app = join(tmp, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], app);

  const specifiers = Object.keys(pkg.exports).map((key) => pkg.name + key.slice(1));
  const smoke = specifiers
    .map((s) => `if (Object.keys(await import(${JSON.stringify(s)})).length === 0) throw new Error('${s} has no exports');`)
    .join('\n');
  writeFileSync(join(app, 'smoke.mjs'), `${smoke}\nconsole.log('Imported ${specifiers.length} entry points');\n`);
  run('node', ['smoke.mjs'], app);

  const skills = join(app, 'node_modules', pkg.name, '.well-known', 'agent-skills', 'index.json');
  if (!existsSync(skills)) throw new Error('The tarball does not contain .well-known/agent-skills');
  console.log('Agent skills are in the tarball');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
