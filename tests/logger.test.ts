import { afterEach, describe, expect, it } from 'vitest';
import { logger, redactPhones, setLogSink } from '../src/lib/logger';

describe('phone redaction in logs', () => {
  afterEach(() => setLogSink((l) => console.log(l)));

  it.each([
    ['+91 98765 43210', '[phone ••••3210]'],
    ['9876543210', '[phone ••••3210]'],
    ['call 020-2567-8901 now', 'call [phone ••••8901] now'],
  ])('%s', (input, out) => {
    expect(redactPhones(input)).toBe(out);
  });

  it('leaves dates, areas and short numbers alone', () => {
    expect(redactPhones('2026-09-02, 1,400 sq ft, 10:30')).toBe('2026-09-02, 1,400 sq ft, 10:30');
  });

  it('redacts nested log fields', () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    logger.info('call.started', { caller: { phone: '+919876543210' }, note: 'ok' });
    expect(lines[0]).not.toContain('9876543210');
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'call.started', caller: { phone: '[phone ••••3210]' } });
  });
});
