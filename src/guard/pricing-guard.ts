import { rulesConfig } from '../../config/rules.config';
import { logger } from '../lib/logger';

/**
 * Output filter that EVERY agent utterance passes through before it is spoken.
 *
 * pricingGuard: any sentence that states or implies a price (currency amount, money unit,
 * per-sq-ft rate, "starts at", "around <number>", cost estimate, price comparison, rate card)
 * is replaced by the approved pricing line. Times, dates, areas, BHK counts and durations are
 * masked first so they are never mistaken for prices.
 *
 * guardAgentUtterance additionally removes sentences the agent must never say (Q13, Q9).
 */

export type GuardReason =
  | 'currency_amount'
  | 'money_unit'
  | 'per_area_rate'
  | 'starts_at'
  | 'approximate_figure'
  | 'cost_estimate'
  | 'price_comparison'
  | 'rate_card'
  | 'number_in_price_context';

export type GuardResult = {
  text: string;
  blocked: boolean;
  reasons: GuardReason[];
  blockedSentences: string[];
};

export type GuardOptions = {
  /** Replacement line. Defaults to the approved pricing line (without the booking suffix). */
  replacement?: string;
  /** Called once per blocked utterance. Defaults to a structured warn log. */
  onBlock?: (info: { reasons: GuardReason[]; blockedSentences: string[] }) => void;
};

const DIGIT = '[0-9०-९]';
const NUMBER = `${DIGIT}[0-9०-९,.]*`;
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';

/** Spans that contain digits but are never prices. Replaced by a neutral token before checks. */
const SAFE_SPANS: RegExp[] = [
  /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])/gi, // 10:30 AM, 6pm
  /\b\d{1,2}:\d{2}\b/g, // 14:30
  new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}\b`, 'gi'), // 4 October
  new RegExp(String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?\b`, 'gi'), // October 4
  /\b(?:19|20)\d{2}\b/g, // years
  /\b\d[\d,]*(?:\.\d+)?\s*(?:sq\.?\s*(?:ft|feet|foot|m|mt|metres?|meters?)|sqft|sft|square\s+(?:feet|foot|metres?|meters?))\b/gi, // areas
  /\b\d\s*bhk\b/gi,
  /\b\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(?:weeks?|days?|months?|years?|hours?|hrs?|minutes?|mins?)\b/gi,
  /\b\d+\s*(?:people|persons?|rooms?|bedrooms?|bathrooms?|cabins?|workstations?|seats?|floors?|members?|designers?|projects?|photos?)\b/gi,
  /\b(?:g|ground)\s*\+\s*\d\b/gi, // G+2
];

const CURRENCY = String.raw`(?:₹|\brs\.?|\binr\b|\brupees?\b|रु\.?|रुपये|रुपए)`;

type Check = { reason: GuardReason; re: RegExp; on: 'raw' | 'masked' };

const CHECKS: Check[] = [
  { reason: 'per_area_rate', on: 'raw', re: /\b(?:per|a|\/)\s*(?:sq(?:uare)?\.?\s*(?:ft|feet|foot|metres?|meters?|m)\b|sqft\b|sft\b)/i },
  { reason: 'currency_amount', on: 'masked', re: new RegExp(`${CURRENCY}\\s*${DIGIT}`, 'i') },
  { reason: 'currency_amount', on: 'masked', re: new RegExp(`${NUMBER}\\s*${CURRENCY}`, 'i') },
  { reason: 'money_unit', on: 'masked', re: new RegExp(`${NUMBER}\\s*(?:lakhs?|lacs?|crores?|cr|l|k|thousand|grand|हज़ार|हजार|लाख|करोड़|करोड)(?![a-z])`, 'i') },
  { reason: 'money_unit', on: 'raw', re: /\b(?:lakhs?|lacs?|crores?|rupees?)\b|₹|लाख|करोड़|रुपये|रुपए/i },
  { reason: 'starts_at', on: 'masked', re: new RegExp(`\\b(?:starts?|starting|start)\\s+(?:at|from)\\s+(?:just\\s+|only\\s+)?(?:${CURRENCY}|${DIGIT})`, 'i') },
  {
    reason: 'approximate_figure',
    on: 'masked',
    re: new RegExp(
      `\\b(?:around|about|approximately|approx\\.?|roughly|ballpark(?:\\s+of)?|in\\s+the\\s+range\\s+of|between|under|over|below|above|upwards\\s+of)\\s+(?:${CURRENCY}\\s*)?${DIGIT}`,
      'i',
    ),
  },
  {
    reason: 'cost_estimate',
    on: 'raw',
    re: /\b(?:typically|usually|normally|generally|on\s+average|average)\s+(?:costs?|runs?|comes?\s+(?:to|out))\b|\bcosts?\s+(?:around|about|roughly|approximately|between|from|under|over|less|more|upwards)\b|\b(?:would|will|should|might|could|may)\s+cost\b|\b(?:packages?|pricing|prices?|rates?|fees?|charges?|costs?)\s+(?:typically\s+|usually\s+)?(?:starts?|start|begins?|starting)\s+(?:at|from)\b/i,
  },
  { reason: 'price_comparison', on: 'raw', re: /\b(?:cheaper|costlier|pricier|more\s+expensive|less\s+expensive|more\s+affordable|better\s+(?:price|rate|deal))\b/i },
  { reason: 'rate_card', on: 'raw', re: /\b(?:rate\s*card|price\s*list|pricing\s*(?:sheet|list|table)|brochure\s+with\s+prices)\b/i },
  {
    reason: 'number_in_price_context',
    on: 'masked',
    re: new RegExp(`(?=.*\\b(?:price|pricing|cost|costs|budget|rate|charge|charges|fee|fees|quote|estimate|amount|expensive|cheap)\\b).*${DIGIT}`, 'i'),
  },
];

function mask(sentence: string): string {
  return SAFE_SPANS.reduce((s, re) => s.replace(re, ' § '), sentence);
}

/** Sentence split that does not break after abbreviations such as "Rs." or "approx.". */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<!(?:^|[^a-z])(?:rs|approx|sq|no|dr|mr|mrs|ms|st|ft)\.)(?<=[.!?।])\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function checkSentence(sentence: string): GuardReason[] {
  const masked = mask(sentence);
  const reasons = new Set<GuardReason>();
  for (const c of CHECKS) if (c.re.test(c.on === 'raw' ? sentence : masked)) reasons.add(c.reason);
  return [...reasons];
}

export function pricingGuard(text: string, opts: GuardOptions = {}): GuardResult {
  const replacement = opts.replacement ?? rulesConfig.scripts.pricing.approved;
  const out: string[] = [];
  const reasons = new Set<GuardReason>();
  const blockedSentences: string[] = [];
  let replaced = false;

  for (const s of splitSentences(text)) {
    // Approved script lines are always allowed through unchanged.
    if (APPROVED_LINES.has(s)) {
      out.push(s);
      continue;
    }
    const r = checkSentence(s);
    if (r.length === 0) {
      out.push(s);
      continue;
    }
    r.forEach((x) => reasons.add(x));
    blockedSentences.push(s);
    if (!replaced) {
      out.push(replacement);
      replaced = true;
    }
  }

  const blocked = blockedSentences.length > 0;
  if (blocked) {
    const info = { reasons: [...reasons], blockedSentences };
    (opts.onBlock ?? ((i) => logger.warn('pricing_guard.blocked', i)))(info);
  }
  return { text: blocked ? out.join(' ') : text, blocked, reasons: [...reasons], blockedSentences };
}

const APPROVED_LINES = new Set(
  [rulesConfig.scripts.pricing.approved, rulesConfig.scripts.pricing.bookingSuffix, rulesConfig.scripts.pricing.pushedAgain].flatMap(
    splitSentences,
  ),
);

/** The approved pricing reply. The booking suffix is added ONLY when the lead is currently Qualified. */
export function approvedPricingReply(opts: { leadQualified: boolean; pushedAgain?: boolean }): string {
  const p = rulesConfig.scripts.pricing;
  if (opts.pushedAgain) return p.pushedAgain;
  return opts.leadQualified ? `${p.approved} ${p.bookingSuffix}` : p.approved;
}

/* ------------------------------------------------------------- forbidden phrases (Q13, Q9) */

const FORBIDDEN: RegExp[] = [
  ...rulesConfig.scripts.neverSay.map((p) => new RegExp(`\\b${p.replace(/\s+/g, '\\s+')}\\b`, 'i')),
  // Q9: never promise a callback time.
  /\b(?:call|ring|get\s+back\s+to)\s+(?:you\s+)?(?:back\s+)?(?:with)?in\s+(?:\d+|an?|one|two|few)\s*(?:minutes?|mins?|hours?|hrs?)\b/i,
];

export type UtteranceGuardResult = GuardResult & { removedForbidden: string[] };

/** Full output filter: pricing guard, then forbidden-phrase removal. Use this before every TTS call. */
export function guardAgentUtterance(text: string, opts: GuardOptions = {}): UtteranceGuardResult {
  const priced = pricingGuard(text, opts);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const s of splitSentences(priced.text)) (FORBIDDEN.some((re) => re.test(s)) ? removed : kept).push(s);
  if (removed.length) logger.warn('utterance_guard.forbidden_removed', { removed });
  return { ...priced, text: removed.length ? kept.join(' ') : priced.text, removedForbidden: removed };
}
