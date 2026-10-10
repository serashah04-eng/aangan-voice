import { z } from 'zod';
import {
  DateExpr,
  FIELD_KEYS,
  FieldKey,
  Outcome,
  Room,
  UNKNOWN,
  type Extraction,
  type FieldValue,
} from '../domain/types';
import { FIELD_SPECS, type ValueKind } from './field-specs';

/* ============================================================ JSON schema sent to the model */

const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: 'null' }] });

const DATE_KINDS = ['date', 'month', 'duration', 'festival', 'now', 'no_deadline', 'unknown'] as const;

function valueSchema(kind: ValueKind): Record<string, unknown> {
  switch (kind.t) {
    case 'enum':
      return { type: 'string', enum: [...kind.values, 'unknown'] };
    case 'number':
      return nullable({ type: 'number' });
    case 'integer':
      return nullable({ type: 'integer' });
    case 'boolean':
      return nullable({ type: 'boolean' });
    case 'string':
      return nullable({ type: 'string' });
    case 'rooms':
      return nullable({ type: 'array', items: { type: 'string', enum: [...Room.options] } });
    case 'date':
      return nullable({
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...DATE_KINDS] },
          date: nullable({ type: 'string', description: 'YYYY-MM-DD, for kind=date' }),
          month: nullable({ type: 'integer', description: '1-12, for kind=month' }),
          year: nullable({ type: 'integer', description: 'only if stated or "next year"' }),
          amount: nullable({ type: 'number', description: 'for kind=duration' }),
          unit: nullable({ type: 'string', enum: ['days', 'weeks', 'months'] }),
          festival: nullable({ type: 'string', description: 'lowercase festival name, for kind=festival' }),
          relation: nullable({ type: 'string', enum: ['before', 'by', 'after'] }),
        },
        required: ['kind'],
      });
  }
}

export function buildResponseJsonSchema(): Record<string, unknown> {
  const fieldProps: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    fieldProps[key] = {
      type: 'object',
      properties: {
        value: valueSchema(FIELD_SPECS[key].kind),
        quote: nullable({ type: 'string', description: 'exact words copied from one CALLER turn' }),
        turn: nullable({ type: 'integer', description: 'index of that caller turn' }),
      },
      required: ['value', 'quote', 'turn'],
    };
  }
  return {
    type: 'object',
    properties: {
      fields: { type: 'object', properties: fieldProps, required: [...FIELD_KEYS] },
      contradictions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { field: { type: 'string', enum: [...FIELD_KEYS] }, quotes: { type: 'array', items: { type: 'string' } } },
          required: ['field', 'quotes'],
        },
      },
      model_suggested_outcome: { type: 'string', enum: [...Outcome.options] },
    },
    required: ['fields', 'contradictions', 'model_suggested_outcome'],
  };
}

/* ============================================================ parsing the model's reply */

const RawField = z.object({
  value: z.unknown(),
  quote: z.string().nullish(),
  turn: z.number().int().nullish(),
});

const RawDate = z.object({
  kind: z.enum(DATE_KINDS),
  date: z.string().nullish(),
  month: z.number().int().nullish(),
  year: z.number().int().nullish(),
  amount: z.number().nullish(),
  unit: z.enum(['days', 'weeks', 'months']).nullish(),
  festival: z.string().nullish(),
  relation: z.enum(['before', 'by', 'after']).nullish(),
});

const RawReply = z.object({
  fields: z.record(z.unknown()).default({}),
  contradictions: z.array(z.object({ field: z.string(), quotes: z.array(z.string()) })).default([]),
  model_suggested_outcome: z.string().optional(),
});

export type ParseIssue = { field: string; problem: string };

function toDateExpr(raw: unknown, allow: 'deadline' | 'start'): DateExpr | null {
  const d = RawDate.safeParse(raw);
  if (!d.success) return null;
  const v = d.data;
  let expr: unknown;
  switch (v.kind) {
    case 'unknown':
      return null;
    case 'date':
      expr = { kind: 'date', date: v.date };
      break;
    case 'month':
      expr = v.year ? { kind: 'month', month: v.month, year: v.year } : { kind: 'month', month: v.month };
      break;
    case 'duration':
      expr = { kind: 'duration', amount: v.amount, unit: v.unit };
      break;
    case 'festival':
      expr = { kind: 'festival', name: (v.festival ?? '').toLowerCase().trim(), relation: v.relation ?? 'by' };
      break;
    case 'now':
      if (allow !== 'start') return null;
      expr = { kind: 'now' };
      break;
    case 'no_deadline':
      if (allow !== 'deadline') return null;
      expr = { kind: 'no_deadline' };
      break;
  }
  const parsed = DateExpr.safeParse(expr);
  return parsed.success ? parsed.data : null;
}

function toValue(kind: ValueKind, raw: unknown): unknown | null {
  if (raw === null || raw === undefined || raw === 'unknown') return null;
  switch (kind.t) {
    case 'enum':
      return typeof raw === 'string' && kind.values.includes(raw) ? raw : null;
    case 'number':
      return typeof raw === 'number' && raw > 0 ? raw : null;
    case 'integer':
      return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;
    case 'boolean':
      return typeof raw === 'boolean' ? raw : null;
    case 'string':
      return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    case 'rooms': {
      const r = z.array(Room).min(1).safeParse(raw);
      return r.success ? r.data : null;
    }
    case 'date':
      return toDateExpr(raw, kind.allow);
  }
}

/**
 * Turn the model's JSON text into a domain Extraction. Lenient per field: a malformed field
 * becomes unknown (and is reported) instead of failing the whole call. Quotes are NOT checked
 * here — that is the quote validator's job, which runs next.
 */
export function parseModelReply(text: string): { extraction: Extraction; issues: ParseIssue[]; modelSuggestedOutcome?: string } {
  const issues: ParseIssue[] = [];
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    json = {};
    issues.push({ field: '*', problem: 'reply was not valid JSON' });
  }
  const reply = RawReply.safeParse(json);
  const body = reply.success ? reply.data : { fields: {}, contradictions: [], model_suggested_outcome: undefined };
  if (!reply.success) issues.push({ field: '*', problem: 'reply did not match the top-level shape' });

  const fields = {} as Record<FieldKey, FieldValue<unknown>>;
  for (const key of FIELD_KEYS) {
    const raw = RawField.safeParse(body.fields[key]);
    if (!raw.success) {
      fields[key] = { ...UNKNOWN };
      if (body.fields[key] !== undefined) issues.push({ field: key, problem: 'field shape invalid' });
      continue;
    }
    const value = toValue(FIELD_SPECS[key].kind, raw.data.value);
    const quote = raw.data.quote?.trim() || null;
    if (value === null) {
      if (raw.data.value !== null && raw.data.value !== undefined && raw.data.value !== 'unknown' && !(typeof raw.data.value === 'object' && (raw.data.value as { kind?: string }).kind === 'unknown')) {
        issues.push({ field: key, problem: `value not valid for ${FIELD_SPECS[key].kind.t}` });
      }
      fields[key] = { ...UNKNOWN };
    } else if (!quote) {
      // false / 0 with no quote = "didn't come up" — not worth flagging.
      if (value !== false && value !== 0) issues.push({ field: key, problem: 'value given without a quote' });
      fields[key] = { ...UNKNOWN };
    } else {
      fields[key] = { value, quote, turn: raw.data.turn ?? null };
    }
  }

  const contradictions = body.contradictions
    .filter((c) => FieldKey.safeParse(c.field).success && c.quotes.length >= 2)
    .map((c) => ({ field: c.field as FieldKey, quotes: c.quotes }));

  const mso = Outcome.safeParse(body.model_suggested_outcome);
  return {
    extraction: {
      fields: fields as Extraction['fields'],
      contradictions,
      validatorFailures: {},
      ...(mso.success ? { modelSuggestedOutcome: mso.data } : {}),
    },
    issues,
    modelSuggestedOutcome: body.model_suggested_outcome,
  };
}
