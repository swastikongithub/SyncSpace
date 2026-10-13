#!/usr/bin/env node
// Writes Brotli (.br) and gzip (.gz) copies of the built text assets, at the highest compression
// levels, so the server can send them without compressing anything per request.
//   node scripts/precompress.js dist
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist';
const COMPRESSIBLE = /\.(js|css|html|svg|json|webmanifest|txt)$/;
const MIN_BYTES = 1024;
let files = 0;
let before = 0;
let after = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!COMPRESSIBLE.test(entry)) continue;
    const source = readFileSync(path);
    if (source.length < MIN_BYTES) continue;
    const brotli = brotliCompressSync(source, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: source.length },
    });
    writeFileSync(`${path}.br`, brotli);
    writeFileSync(`${path}.gz`, gzipSync(source, { level: 9 }));
    files += 1;
    before += source.length;
    after += brotli.length;
  }
}

walk(root);
console.log(`Precompressed ${files} files: ${(before / 1024).toFixed(0)} KiB -> ${(after / 1024).toFixed(0)} KiB with Brotli.`);
