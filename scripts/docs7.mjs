#!/usr/bin/env node
// Generates the Docs7 site in docs7/ from the repository's Markdown sources.
// Usage: node scripts/docs7.mjs           regenerate docs7/
//        node scripts/docs7.mjs --check   exit 1 when docs7/ is out of date
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs7');
const BLOB = 'https://github.com/senrecep/tsentials/blob/main/';
const RAW = 'https://raw.githubusercontent.com/senrecep/tsentials/main/';
const SITE = {
  $schema: 'https://mintlify.com/docs.json',
  theme: 'mint',
  name: 'tsentials',
  colors: { primary: '#3178c6', light: '#3178c6', dark: '#5a9bd8' },
  navbar: { primary: { type: 'github', href: 'https://github.com/senrecep/tsentials' } },
  footer: { socials: { github: 'https://github.com/senrecep/tsentials' } },
};
const LINK = /(\]\()([^)\s]+)(\))/g;
const IMG_TAG = /(<img\s[^>]*src=")([^"]+)(")/g;
const HTML_LESS_THAN = /(?<!\\)<(?!\/?(?:a|img|p|br|div|span|details|summary|sub|sup|kbd|code|strong|em|b|i|picture|source|table|thead|tbody|tr|td|th)\b)/g;
const IMAGE_EXT = new Set(['.png', '.svg', '.jpg', '.jpeg', '.gif', '.webp']);

const dirs = (path) =>
  existsSync(path) ? readdirSync(path).filter((n) => statSync(join(path, n)).isDirectory()).sort() : [];
const files = (path, ext) => (existsSync(path) ? readdirSync(path).filter((n) => n.endsWith(ext)).sort() : []);

function collect() {
  const pages = new Map([[join(ROOT, 'README.md'), 'index']]);
  const groups = { Modules: [], Guides: [], Examples: [] };
  const skills = join(ROOT, '.well-known', 'agent-skills');
  for (const name of dirs(skills)) {
    const source = join(skills, name, 'SKILL.md');
    if (!existsSync(source)) continue;
    const page = `modules/${name === 'tsentials' ? 'overview' : name.replace(/^tsentials-/, '')}`;
    pages.set(source, page);
    groups.Modules.push(page);
  }
  for (const name of files(join(ROOT, 'docs'), '.md')) {
    const page = `guides/${name.replace(/\.md$/, '').toLowerCase()}`;
    pages.set(join(ROOT, 'docs', name), page);
    groups.Guides.push(page);
  }
  for (const name of dirs(join(ROOT, 'examples'))) {
    const source = join(ROOT, 'examples', name, 'README.md');
    if (!existsSync(source)) continue;
    pages.set(source, `examples/${name}`);
    groups.Examples.push(`examples/${name}`);
  }
  const nav = [{ group: 'Get started', pages: ['index'] }];
  for (const [group, list] of Object.entries(groups)) if (list.length) nav.push({ group, pages: list });
  return { pages, nav };
}

function rewrite(target, source, pages) {
  if (/^[a-z]+:|^#|^\//i.test(target)) return target;
  const [path, anchor] = target.split('#');
  const resolved = resolve(dirname(source), path);
  const suffix = anchor ? `#${anchor}` : '';
  const page = pages.get(resolved);
  if (page) return `/${page}${suffix}`;
  const rel = relative(ROOT, resolved);
  if (rel.startsWith('..')) return target;
  const base = IMAGE_EXT.has(extname(resolved).toLowerCase()) ? RAW : BLOB;
  return base + rel.split('\\').join('/') + suffix;
}

function escapeBraces(line) {
  return line
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/[{}]/g, (c) => `\\${c}`).replace(HTML_LESS_THAN, '\\<')))
    .join('');
}

function convert(source, pages) {
  let text = readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
  let description = null;
  const front = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (front) text = text.slice(front[0].length);
  text = text.replace(/^\s*<p align="center">[\s\S]*?<\/p>\s*/, '');
  const heading = text.match(/^# (.+)$/m);
  const title = heading ? heading[1].trim() : source;
  if (heading) text = text.slice(0, heading.index) + text.slice(heading.index + heading[0].length);
  const out = [];
  let fenced = false;
  for (let line of text.replace(/^\n+/, '').split('\n')) {
    if (line.trimStart().startsWith('```')) fenced = !fenced;
    else if (!fenced) {
      line = line.replace(LINK, (_, a, t, b) => a + rewrite(t, source, pages) + b);
      line = line.replace(IMG_TAG, (_, a, t, b) => a + rewrite(t, source, pages) + b);
      line = escapeBraces(line);
    }
    out.push(line);
  }
  if (pages.get(source) === 'index') {
    description = out.find((l) => l && !/^[[!<|#>]/.test(l))?.trim() ?? null;
  }
  const head = ['---', `title: ${JSON.stringify(title)}`];
  if (description) head.push(`description: ${JSON.stringify(description)}`);
  return `${[...head, '---', '', ...out].join('\n').trimEnd()}\n`;
}

function build(dest) {
  const { pages, nav } = collect();
  for (const [source, page] of pages) {
    const target = join(dest, `${page}.mdx`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, convert(source, pages));
  }
  writeFileSync(join(dest, 'docs.json'), `${JSON.stringify({ ...SITE, navigation: { groups: nav } }, null, 2)}\n`);
}

function snapshot(folder, base = folder, acc = new Map()) {
  if (!existsSync(folder)) return acc;
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) snapshot(path, base, acc);
    else acc.set(relative(base, path), readFileSync(path, 'utf8'));
  }
  return acc;
}

if (process.argv.includes('--check')) {
  const tmp = mkdtempSync(join(tmpdir(), 'docs7-'));
  build(tmp);
  const expected = snapshot(tmp);
  const actual = snapshot(OUT);
  rmSync(tmp, { recursive: true, force: true });
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  const stale = [...keys].filter((k) => expected.get(k) !== actual.get(k)).sort();
  if (stale.length) {
    console.log(`docs7/ is out of date; run node scripts/docs7.mjs. Changed: ${stale.join(', ')}`);
    process.exit(1);
  }
  console.log('docs7/ is up to date.');
} else {
  rmSync(OUT, { recursive: true, force: true });
  build(OUT);
  const count = [...snapshot(OUT).keys()].filter((k) => k.endsWith('.mdx')).length;
  console.log(`Wrote ${count} pages to docs7/.`);
}
