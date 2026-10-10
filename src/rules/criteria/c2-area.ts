import { rulesConfig } from '../../../config/rules.config';
import type { CriterionResult, ExtractionFields } from '../../domain/types';
import { ev, known, result } from '../fields';
import { matchLocality } from '../locality';

/** C2 — service area. */
export function evalC2(f: ExtractionFields): CriterionResult {
  if (!known(f.locality)) return result('unknown', 'C2.UNKNOWN_NOT_GIVEN');
  const evidence = ev('locality', f.locality);
  const m = matchLocality(f.locality.value);

  switch (m.kind) {
    case 'listed':
      return result('pass', m.via === 'alias' ? 'C2.PASS_LISTED_ALIAS' : 'C2.PASS_LISTED', evidence, {
        detail: { canonical: m.canonical, zone: m.zone },
      });
    case 'excluded':
      return result('fail', 'C2.FAIL_OUTSIDE_SERVICE_AREA', evidence, {
        note: `${m.canonical.replace(/\b\w/g, (c) => c.toUpperCase())} is outside Pune and PCMC, where our vendor network works.`,
        detail: { canonical: m.canonical },
      });
    case 'generic':
      return result('unknown', 'C2.UNKNOWN_PUNE_ONLY', evidence);
    case 'unlisted':
      return result(rulesConfig.serviceArea.unlistedLocalityState, 'C2.ESCALATE_UNLISTED_LOCALITY', evidence, {
        note: `Locality "${f.locality.value}" is on neither list (Q5).`,
      });
  }
}
