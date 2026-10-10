import { rulesConfig } from '../../../config/rules.config';
import type { CriterionResult, Evidence, ExtractionFields, Room } from '../../domain/types';
import { ev, hasTerm, known, normaliseText, result } from '../fields';

const res = rulesConfig.residential;
const com = rulesConfig.commercial;

export type ProjectShape =
  | { category: 'unknown' }
  | { category: 'commercial' }
  | {
      category: 'residential';
      scope: 'full_home' | 'full_floor' | 'rooms' | 'unknown';
      scopeInferredFromBhk: boolean;
    };

/** Category and residential scope, including the documented inferences. Shared with C4. */
export function projectShape(f: ExtractionFields): ProjectShape {
  const category = known(f.property_category)
    ? f.property_category.value
    : known(f.commercial_type)
      ? 'commercial'
      : known(f.bhk) || known(f.scope_kind) || known(f.rooms) || known(f.residential_kind)
        ? 'residential'
        : 'unknown';

  if (category === 'unknown') return { category };
  if (category === 'commercial') return { category };

  if (known(f.scope_kind)) return { category, scope: f.scope_kind.value, scopeInferredFromBhk: false };
  if (known(f.rooms)) return { category, scope: 'rooms', scopeInferredFromBhk: false };
  if (known(f.bhk) && res.bhkImpliesFullHome) return { category, scope: 'full_home', scopeInferredFromBhk: true };
  return { category, scope: 'unknown', scopeInferredFromBhk: false };
}

export function isResidentialFullHome(f: ExtractionFields): boolean {
  const s = projectShape(f);
  return s.category === 'residential' && s.scope === 'full_home';
}

/** Canonical commercial type from free text: fail list → explicitly unlisted → pass list → other. */
export function classifyCommercialType(raw: string): { kind: 'fail' | 'pass' | 'unlisted'; type: string } {
  const text = normaliseText(raw);
  for (const t of com.failTypes) {
    if ((com.typeKeywords[t] ?? [t]).some((k) => hasTerm(text, k))) return { kind: 'fail', type: t };
  }
  for (const k of com.unlistedKeywords) if (hasTerm(text, k)) return { kind: 'unlisted', type: k };
  for (const t of com.passTypes) {
    if ((com.typeKeywords[t] ?? [t]).some((k) => hasTerm(text, k))) return { kind: 'pass', type: t };
  }
  return { kind: 'unlisted', type: text };
}

function scopeEvidence(f: ExtractionFields): Evidence[] {
  return [
    ...ev('property_category', f.property_category),
    ...ev('scope_kind', f.scope_kind),
    ...ev('bhk', f.bhk),
    ...ev('rooms', f.rooms),
  ];
}

/** C1b — project type and scope. */
export function evalC1b(f: ExtractionFields): CriterionResult {
  const shape = projectShape(f);

  if (shape.category === 'unknown') return result('unknown', 'C1b.UNKNOWN_PROJECT_TYPE');

  if (shape.category === 'commercial') {
    const evidence = [...ev('commercial_type', f.commercial_type), ...ev('area_sqft', f.area_sqft)];
    if (!known(f.commercial_type)) return result('unknown', 'C1b.UNKNOWN_COMMERCIAL_TYPE', evidence);
    const cls = classifyCommercialType(f.commercial_type.value);
    if (cls.kind === 'fail') {
      return result('fail', `C1b.FAIL_COMMERCIAL_${cls.type.toUpperCase()}`, evidence, {
        note: `We don't take on ${cls.type} interiors.`,
        detail: { commercialType: cls.type },
      });
    }
    if (cls.kind === 'unlisted') {
      return result(com.unlistedTypeState, 'C1b.ESCALATE_UNLISTED_COMMERCIAL_TYPE', evidence, {
        note: `Commercial type "${cls.type}" is not on the studio's list (Q6).`,
        detail: { commercialType: cls.type },
      });
    }
    if (!known(f.area_sqft)) {
      return result('unknown', 'C1b.UNKNOWN_COMMERCIAL_AREA', evidence, { detail: { commercialType: cls.type } });
    }
    const a = f.area_sqft.value;
    if (a < com.minSqft || a > com.maxSqft) {
      return result(com.outOfRangeState, 'C1b.ESCALATE_COMMERCIAL_SIZE_OUT_OF_RANGE', evidence, {
        note: `Commercial ${cls.type} of ${a} sq ft is outside the usual range (Q6).`,
        detail: { commercialType: cls.type, areaSqft: a },
      });
    }
    return result('pass', 'C1b.PASS_COMMERCIAL_IN_RANGE', evidence, { detail: { commercialType: cls.type, areaSqft: a } });
  }

  const evidence = scopeEvidence(f);
  switch (shape.scope) {
    case 'unknown':
      return result('unknown', 'C1b.UNKNOWN_RESIDENTIAL_SCOPE', evidence);
    case 'full_floor':
      return result('pass', 'C1b.PASS_FULL_FLOOR', evidence);
    case 'full_home': {
      if (known(f.bhk) && f.bhk.value < res.minFullHomeBhk) {
        return result(res.belowMinFullHomeState, 'C1b.ESCALATE_1BHK_FULL_HOME', evidence, {
          note: `${f.bhk.value}BHK full home (Q7).`,
        });
      }
      return result('pass', shape.scopeInferredFromBhk ? 'C1b.PASS_FULL_HOME_FROM_BHK' : 'C1b.PASS_FULL_HOME', evidence);
    }
    case 'rooms': {
      if (!known(f.rooms)) return result('unknown', 'C1b.UNKNOWN_ROOMS', evidence);
      const items = f.rooms.value as Room[];
      const rooms = items.filter((r) => !(res.nonRoomItems as readonly string[]).includes(r));
      if (rooms.length >= 2) return result('pass', 'C1b.PASS_TWO_OR_MORE_ROOMS', evidence, { detail: { rooms } });
      if (rooms.length === 0) {
        return result(res.singleRoomQ7State, 'C1b.ESCALATE_WARDROBE_ONLY', evidence, { note: 'Wardrobe-only scope (Q7).' });
      }
      const only = rooms[0]!;
      if ((res.singleRoomPass as readonly string[]).includes(only)) {
        return result('pass', 'C1b.PASS_SINGLE_BEDROOM_OR_LIVING', evidence, { detail: { rooms } });
      }
      if ((res.singleRoomQ7 as readonly string[]).includes(only)) {
        return result(res.singleRoomQ7State, `C1b.ESCALATE_${only.toUpperCase()}_ONLY`, evidence, {
          note: `${only}-only scope (Q7).`,
        });
      }
      return result(res.otherSingleRoomState, 'C1b.ESCALATE_OTHER_SINGLE_ROOM', evidence, {
        note: `Single ${only} only (Q21).`,
      });
    }
  }
}
