#!/usr/bin/env node
// Fails if project-owned files introduce TypeScript: .ts/.tsx/.mts/.cts sources, declaration
// files, tsconfig files, or a `typescript` dependency in any workspace manifest.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', 'playwright-report', 'test-results', '.claude', '.agents']);
const FORBIDDEN = /\.(ts|tsx|mts|cts)$/i;
const problems = [];
const manifests = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    const rel = relative(root, path).replaceAll('\\', '/');
    if (FORBIDDEN.test(entry)) problems.push(`TypeScript file: ${rel}`);
    if (/^tsconfig.*\.json$/i.test(entry)) problems.push(`TypeScript configuration: ${rel}`);
    if (entry === 'package.json') manifests.push(path);
  }
}

walk(root);

for (const path of manifests) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name === 'typescript' || name === 'ts-node' || name === 'tsx' || name.startsWith('@types/')) {
        problems.push(`${relative(root, path).replaceAll('\\', '/')}: ${field} includes ${name}`);
      }
    }
  }
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (/\btsc\b|\bts-node\b/.test(command)) problems.push(`${relative(root, path).replaceAll('\\', '/')}: script "${name}" runs TypeScript`);
  }
}

if (problems.length > 0) {
  console.error(`JavaScript-only check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`JavaScript-only check passed (${manifests.length} package manifests scanned).`);
