/**
 * Structured JSON logger. Phone numbers are redacted from every message and field
 * (keeps the last 4 digits) before anything is written.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

export function redactPhones(s: string): string {
  return s.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 10 || /^\d{4}-\d{2}-\d{2}/.test(m.trim())) return m; // too short, or an ISO date
    return `[phone ••••${digits.slice(-4)}]`;
  });
}

function redactDeep(v: unknown): unknown {
  if (typeof v === 'string') return redactPhones(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redactDeep(x)]));
  }
  return v;
}

export type LogSink = (line: string) => void;
let sink: LogSink = (line) => console.log(line);

/** Tests can capture output. */
export function setLogSink(s: LogSink): void {
  sink = s;
}

function write(level: Level, event: string, data: Record<string, unknown> = {}): void {
  sink(JSON.stringify({ level, event, ...(redactDeep(data) as Record<string, unknown>) }));
}

export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => write('debug', event, data),
  info: (event: string, data?: Record<string, unknown>) => write('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => write('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => write('error', event, data),
};
