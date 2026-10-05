import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// package.json says "type": "module" and Vercel's Node runtime does not rewrite specifiers, so every relative
// runtime import reachable from a function must name its file (`./x.js`, which TypeScript and Vite map to x.ts).
const ROOT = resolve(__dirname, '../../..');

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Relative specifiers that survive compilation: not `import type` / `export type`. Handles multi-line import lists and import(). */
function runtimeRelativeImports(source: string): string[] {
  const found: string[] = [];
  const stmt = /^\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]*)['"]/gm;
  for (const m of source.matchAll(stmt)) found.push(m[1]);
  for (const m of source.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]*)['"]\s*\)/g)) found.push(m[1]);
  return found;
}

/** Every file a function can load: api/**, plus whatever those import, transitively. */
function reachable(): string[] {
  const seen = new Set<string>();
  const queue = tsFiles(join(ROOT, 'api'));
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeRelativeImports(readFileSync(file, 'utf8'))) {
      // Follow the file even when the extension is missing, so a bad import is reported instead of hiding the files behind it.
      const target = [spec.replace(/\.js$/, '.ts'), `${spec}.ts`].map((c) => resolve(dirname(file), c)).find((c) => existsSync(c));
      if (target) queue.push(target);
    }
  }
  return [...seen];
}

describe('relative imports in functions (ESM needs the extension)', () => {
  it('finds the files it should check', () => {
    const rel = reachable().map((f) => f.slice(ROOT.length + 1));
    expect(rel).toContain('api/stations.ts');
    expect(rel).toContain('api/admin/stations.ts');
    expect(rel).toContain('src/radio/schema.ts');
    expect(rel).toContain('src/radio/builtin.ts');
  });
  it('recognises what it should flag', () => {
    expect(runtimeRelativeImports("import { a } from './a';\nimport b from '../b.js';\nimport type { C } from './c';\nexport { d } from './d';\nexport type { E } from './e';")).toEqual(['./a', '../b.js', './d']);
    expect(runtimeRelativeImports("import {\n  a,\n  type B,\n} from './multi';\nimport './side-effect';\nconst m = await import('./dyn');")).toEqual(['./multi', './side-effect', './dyn']);
  });
  it('every relative runtime import ends in .js (or another real extension)', () => {
    const bad: string[] = [];
    for (const file of reachable()) {
      for (const spec of runtimeRelativeImports(readFileSync(file, 'utf8'))) {
        if (!/\.(js|json)$/.test(spec)) bad.push(`${file.slice(ROOT.length + 1)}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
