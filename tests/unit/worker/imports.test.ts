import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Worker runs on Web APIs only: no Node built-ins (no nodejs_compat flag) and nothing from Vercel.
// This checks every file the Worker can load: worker/**, plus whatever those import, transitively.
const ROOT = resolve(__dirname, '../../..');

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Every module specifier in a file: static imports and re-exports (type-only included, they cost nothing to check), import() and require(). */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const stmt = /^\s*(?:import|export)\s+(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const m of source.matchAll(stmt)) found.push(m[1]);
  for (const m of source.matchAll(/\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1]);
  return found;
}

function reachable(): string[] {
  const seen = new Set<string>();
  const queue = tsFiles(join(ROOT, 'worker'));
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      const target = [spec.replace(/\.js$/, '.ts'), `${spec}.ts`].map((c) => resolve(dirname(file), c)).find((c) => existsSync(c));
      if (target) queue.push(target);
    }
  }
  return [...seen];
}

const NODE_BUILTINS = new Set(builtinModules);
const forbidden = (spec: string): boolean => spec.startsWith('node:') || NODE_BUILTINS.has(spec.split('/')[0]) || spec.startsWith('@vercel/');

describe('Worker imports', () => {
  it('finds the files it should check', () => {
    const rel = reachable().map((f) => f.slice(ROOT.length + 1));
    expect(rel).toContain('worker/index.ts');
    expect(rel).toContain('worker/routes/admin/stations.ts');
    expect(rel).toContain('worker/lib/session.ts');
    expect(rel).toContain('src/radio/schema.ts');
    expect(rel).toContain('src/radio/ids.ts');
    expect(rel).toContain('src/core/judge.ts');
    expect(rel).toContain('src/core/board.ts');
    expect(rel).not.toContain('src/radio/builtin.ts'); // it reaches the browser-only render modules
  });
  it('recognises what it should flag', () => {
    expect(specifiers("import { a } from 'node:crypto';\nimport b from 'crypto';\nimport type { C } from '@vercel/blob';\nexport { d } from './d.js';\nconst e = await import('fs');\nconst f = require('node:fs');")).toEqual([
      'node:crypto',
      'crypto',
      '@vercel/blob',
      './d.js',
      'fs',
      'node:fs',
    ]);
    expect(['node:crypto', 'crypto', 'fs/promises', '@vercel/blob/client'].every(forbidden)).toBe(true);
    expect(['./x.js', '../../src/radio/schema.js', '@cloudflare/workers-types'].some(forbidden)).toBe(false);
  });
  it('reaches no browser code: only the pure core, the shared API types and names, and the station schema', () => {
    const safe = /^src\/(core\/[a-z-]+\.ts|api\/(types|names)\.ts|radio\/(schema|ids)\.ts)$/;
    const src = reachable()
      .map((f) => f.slice(ROOT.length + 1))
      .filter((f) => f.startsWith('src/'));
    expect(src.filter((f) => !safe.test(f))).toEqual([]);
  });
  it('no node: built-ins and no @vercel packages anywhere the Worker can reach', () => {
    const bad: string[] = [];
    for (const file of reachable()) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) if (forbidden(spec)) bad.push(`${file.slice(ROOT.length + 1)}: ${spec}`);
    }
    expect(bad).toEqual([]);
  });
});
