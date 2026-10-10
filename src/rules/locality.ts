import { rulesConfig } from '../../config/rules.config';
import { hasTerm, normaliseText } from './fields';

export type LocalityMatch =
  | { kind: 'listed'; canonical: string; zone: 'pune' | 'pcmc'; via: 'name' | 'alias' }
  | { kind: 'excluded'; canonical: string }
  | { kind: 'generic' }
  | { kind: 'unlisted'; text: string };

const area = rulesConfig.serviceArea;

function zoneOf(canonical: string): 'pune' | 'pcmc' {
  return (area.pcmc as readonly string[]).includes(canonical) ? 'pcmc' : 'pune';
}

/** Longest terms first so "pimple saudagar" wins over a shorter overlapping term. */
const byLength = (a: string, b: string) => b.length - a.length;

/**
 * Deterministic locality match: aliases → listed names → named exclusions / other cities →
 * "Pune only" → unlisted. Case-insensitive, whole-word.
 */
export function matchLocality(raw: string): LocalityMatch {
  const text = normaliseText(raw).replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();

  for (const alias of Object.keys(area.aliases).sort(byLength)) {
    if (hasTerm(text, alias)) {
      const canonical = area.aliases[alias]!;
      return { kind: 'listed', canonical, zone: zoneOf(canonical), via: 'alias' };
    }
  }
  for (const name of [...area.pune, ...area.pcmc].sort(byLength)) {
    if (hasTerm(text, name)) return { kind: 'listed', canonical: name, zone: zoneOf(name), via: 'name' };
  }
  for (const name of [...area.excluded, ...area.otherCities].sort(byLength)) {
    if (hasTerm(text, name)) return { kind: 'excluded', canonical: name };
  }

  let rest = ` ${text.replace(/\b\d+\s*bhk\b/g, ' ')} `;
  for (const w of [...area.genericWords].sort(byLength)) {
    rest = rest.replace(new RegExp(`(^|\\s)${w.replace(/[-]/g, '\\-')}(?=\\s|$)`, 'g'), ' ');
  }
  if (rest.replace(/[^a-z0-9]/g, '') === '') return { kind: 'generic' };

  return { kind: 'unlisted', text };
}
