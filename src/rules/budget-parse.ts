/**
 * Deterministic parser for a caller-volunteered budget (C4, Q2). The model never parses budgets;
 * it only passes the verbatim quote. Returns the MAXIMUM amount mentioned, in rupees.
 *
 * Recognises: ₹ / Rs / INR / rupees prefixes; lakh / lac / L, crore / cr, k / thousand suffixes;
 * ranges with "-", "–" or "to"; Indian digit grouping; Devanagari digits; a few English and
 * Hindi number words used with a unit.
 */

export type BudgetParse = {
  /** Largest amount found, in rupees; null if no amount could be read. */
  maxInr: number | null;
  /** True if the text contains a currency word/symbol or money unit at all. */
  hasAmountCue: boolean;
};

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10,
  dedh: 1.5, dhai: 2.5, 'one and a half': 1.5, 'half a': 0.5,
};

const UNIT_MULTIPLIER: Array<[RegExp, number]> = [
  [/^(lakhs?|lacs?|l|लाख)$/i, 100_000],
  [/^(crores?|cr|करोड़|करोड)$/i, 10_000_000],
  [/^(k|thousand|hazaar|hazar|हज़ार|हजार)$/i, 1_000],
];

const NUM = String.raw`\d+(?:,\d+)*(?:\.\d+)?`;
const UNIT = String.raw`lakhs?|lacs?|crores?|cr|l|k|thousand|hazaar|hazar|लाख|करोड़|करोड|हज़ार|हजार`;
const CURRENCY = String.raw`₹|\brs\.?|\binr\b|\brupees?\b|रु\.?|रुपये|रुपए`;

const AMOUNT_RE = new RegExp(
  String.raw`(${CURRENCY})?\s*(${NUM})(?:\s*(?:-|–|—|to)\s*(?:${CURRENCY})?\s*(${NUM}))?\s*(${UNIT})?(?![a-z])`,
  'gi',
);

const WORD_AMOUNT_RE = new RegExp(
  String.raw`\b(${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')})\s+(${UNIT})(?![a-z])`,
  'gi',
);

const CUE_RE = new RegExp(String.raw`(${CURRENCY})|\b(lakhs?|lacs?|crores?)\b|लाख|करोड़`, 'i');

function toAscii(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

function multiplierFor(unit: string | undefined): number | null {
  if (!unit) return null;
  for (const [re, m] of UNIT_MULTIPLIER) if (re.test(unit.trim())) return m;
  return null;
}

export function parseBudget(raw: string): BudgetParse {
  const text = toAscii(raw);
  const amounts: number[] = [];

  for (const m of text.matchAll(AMOUNT_RE)) {
    const [, currency, a, b, unit] = m;
    const mult = multiplierFor(unit);
    if (!currency && mult === null) continue; // a bare number is not money ("2BHK", "20 people")
    const factor = mult ?? 1;
    for (const n of [a, b]) {
      if (n === undefined) continue;
      const v = Number(n.replace(/,/g, ''));
      if (Number.isFinite(v)) amounts.push(v * factor);
    }
  }

  for (const m of text.matchAll(WORD_AMOUNT_RE)) {
    const n = NUMBER_WORDS[m[1]!.toLowerCase()];
    const mult = multiplierFor(m[2]);
    if (n !== undefined && mult !== null) amounts.push(n * mult);
  }

  return {
    maxInr: amounts.length ? Math.max(...amounts) : null,
    hasAmountCue: CUE_RE.test(text) || amounts.length > 0,
  };
}
