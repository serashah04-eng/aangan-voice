import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rulesConfig } from '../config/rules.config';

/**
 * Guards against a file being re-saved with the wrong encoding (Windows PowerShell 5.1 does this):
 * UTF-8 text decoded as Windows-1252 turns an em dash into a three-character sequence starting
 * with U+00E2 U+20AC. Spoken script lines live in config, so a corrupted file would make the
 * agent read gibberish aloud. (Patterns are written as escapes so this file doesn't flag itself.)
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MOJIBAKE = /\u00e2\u20ac|\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\uFFFD/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.next', 'reports'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|sql|md|json|csv)$/.test(name) && name !== 'package-lock.json') out.push(p);
  }
  return out;
}

describe('file encoding', () => {
  it('no source file contains mojibake or a UTF-8 BOM', () => {
    const bad = walk(ROOT)
      .filter((f) => {
        const t = readFileSync(f, 'utf8');
        return t.startsWith('﻿') || MOJIBAKE.test(t);
      })
      .map((f) => relative(ROOT, f));
    expect(bad).toEqual([]);
  });

  it('spoken script lines contain the intended punctuation', () => {
    expect(rulesConfig.scripts.greeting).toContain("virtual assistant — this call is recorded");
    expect(rulesConfig.scripts.pricing.approved).toContain('the scope — your designer');
  });
});
