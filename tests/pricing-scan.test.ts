import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Repo-wide pricing scan (brief §7 Phase 1). Fails if a rupee figure or a per-sq-ft rate
 * appears anywhere in source, config, prompts, scripts, app code or test fixtures.
 *
 * Allowed, by design (Phase 0 decision C / Q26):
 *  - a line carrying `pricing-scan:allow <reason>` (only the C4 budget threshold today);
 *  - in tests/fixtures/: caller speech lines (`C(` …) and `budget_raw:` lines — these are
 *    figures CALLERS volunteered, which the system must record verbatim;
 *  - tests/fixtures/aangan_test_cases.csv — the labelled test set as supplied; its figures
 *    are callers' volunteered budgets and a caller's guess ("is it over 10 lakh?").
 * Test files themselves (*.test.ts) are not scanned: the guard's tests need price-like inputs.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['src', 'config', 'app', 'scripts', 'prompts', 'supabase', 'docs', join('tests', 'fixtures'), join('tests', 'helpers')];
const SCAN_ROOT_FILES = ['README.md', '.env.example'];
const EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|md|txt|csv|sql|yaml|yml|prompt)$/i;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'coverage']);
const ALLOWED_FILES = new Set([join('tests', 'fixtures', 'aangan_test_cases.csv')]);

export const PRICE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'currency + number', re: /(?:₹|\brs\.?|\binr\b|\brupees?\b)\s*\d/i },
  { name: 'number + lakh/crore', re: /\d[\d,.]*\s*(?:lakhs?|lacs?|crores?|cr)\b/i },
  { name: 'number + Hindi money unit', re: /[\d०-९][\d०-९,.]*\s*(?:लाख|करोड़|करोड)/ },
  { name: 'per-sq-ft rate', re: /\d[\d,.]*\s*(?:\/|per)\s*(?:sq\.?\s*(?:ft|feet|foot)|sqft|sft|square\s*(?:feet|foot))\b/i },
  { name: 'per-sq-ft rate (word first)', re: /\bper\s*(?:sq\.?\s*ft|sqft|square\s*(?:feet|foot))\s*(?:is|of|at|:|=|-)?\s*(?:₹|rs\.?\s*)?\d/i },
];

export function findPrices(text: string): string[] {
  return PRICE_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

function isAllowedLine(file: string, line: string): boolean {
  if (line.includes('pricing-scan:allow')) return true;
  if (file.startsWith(join('tests', 'fixtures') + sep)) {
    const t = line.trim();
    if (t.startsWith('C(') || t.startsWith('budget_raw:')) return true;
  }
  return false;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTENSIONS.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
}

function scanRepo(): Array<{ file: string; line: number; text: string; hits: string[] }> {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  for (const f of SCAN_ROOT_FILES) files.push(join(ROOT, f));

  const findings: Array<{ file: string; line: number; text: string; hits: string[] }> = [];
  for (const abs of files) {
    const file = relative(ROOT, abs);
    if (ALLOWED_FILES.has(file)) continue;
    let content: string;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    content.split(/\r?\n/).forEach((text, i) => {
      if (isAllowedLine(file, text)) return;
      const hits = findPrices(text);
      if (hits.length) findings.push({ file, line: i + 1, text: text.trim().slice(0, 160), hits });
    });
  }
  return findings;
}

describe('repo-wide pricing scan', () => {
  it('detector self-test: catches price figures and rates', () => {
    for (const s of ['₹ 1,500', 'Rs. 2000', 'INR 900', '12 lakh', '1.5 crore', '१५ लाख', '1,800 per sq ft', '2000/sqft', 'per sq ft: 1800']) {
      expect(findPrices(s), s).not.toEqual([]);
    }
  });

  it('detector self-test: ignores areas, times, BHK and plain text about pricing', () => {
    for (const s of ['1,400 sq ft', '10:30 AM, Saturday 4 October', '3BHK', 'per sq ft rate', 'Pricing depends on the site']) {
      expect(findPrices(s), s).toEqual([]);
    }
  });

  it('finds no rupee figure or per-sq-ft rate in source, config, prompts or fixtures', () => {
    expect(scanRepo()).toEqual([]);
  });

  it('the single allowlisted config line is the documented Q2 threshold', () => {
    const cfg = readFileSync(join(ROOT, 'config', 'rules.config.ts'), 'utf8');
    const allowed = cfg.split(/\r?\n/).filter((l) => l.includes('pricing-scan:allow'));
    expect(allowed).toHaveLength(1);
    expect(allowed[0]).toMatch(/fullHomeFloorInr/);
  });
});
