import type { CaseFixture } from './_helpers';
import { phoneCases } from './phone';
import { syntheticCases } from './synthetic';
import { webformCases } from './webform';
import { whatsappCases } from './whatsapp';

export type { CaseFixture } from './_helpers';
export { s20 } from './synthetic';

export const allCases: CaseFixture[] = [...phoneCases, ...whatsappCases, ...webformCases, ...syntheticCases];

export const casesById: Map<string, CaseFixture> = new Map(allCases.map((c) => [c.id, c]));
