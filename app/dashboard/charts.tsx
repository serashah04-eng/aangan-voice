/**
 * Small server-rendered SVG charts (no client JS). Marks: thin bars, 4px rounded data ends
 * anchored at the baseline, 2px surface gap between stacked fills, recessive axis.
 * Hover: each bar group carries a native tooltip (<title>) with exact values; a table view
 * is provided beneath each chart.
 */

type Day = { date: string; inHours: number; afterHours: number };

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function CallsPerDayChart({ days }: { days: Day[] }) {
  const W = 720;
  const H = 180;
  const padL = 28;
  const padB = 22;
  const max = Math.max(1, ...days.map((d) => d.inHours + d.afterHours));
  const step = (W - padL) / Math.max(1, days.length);
  const barW = Math.max(3, Math.min(22, step * 0.62));
  const padT = 10;
  const y = (v: number) => padT + (H - padB - padT) * (1 - v / max);
  const ticks = [0, Math.ceil(max / 2), max];
  const labelEvery = Math.ceil(days.length / 8);

  return (
    <figure style={{ margin: 0 }}>
      <div className="legend" aria-hidden="true">
        <span><span className="swatch" style={{ background: 'var(--series-1)' }} />10am–7pm</span>
        <span><span className="swatch" style={{ background: 'var(--series-2)' }} />After hours</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Calls per day, split by in-hours and after-hours" style={{ display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} fontSize={10} textAnchor="end" fill="var(--text-muted)">{t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = padL + i * step + (step - barW) / 2;
          const hIn = (H - padB) - y(d.inHours);
          const hAfter = (H - padB) - y(d.afterHours);
          const gap = d.inHours && d.afterHours ? 2 : 0;
          return (
            <g key={d.date} className="bar-hit">
              <title>{`${fmtDay(d.date)}: ${d.inHours + d.afterHours} calls (${d.inHours} in hours, ${d.afterHours} after hours)`}</title>
              <rect x={x - 2} y={0} width={barW + 4} height={H - padB} fill="transparent" />
              {d.inHours > 0 && <rect className="bar-fill" x={x} y={y(d.inHours)} width={barW} height={hIn} rx={Math.min(4, barW / 2)} fill="var(--series-1)" />}
              {d.afterHours > 0 && (
                <rect className="bar-fill" x={x} y={y(d.inHours + d.afterHours)} width={barW} height={Math.max(1, hAfter - gap)} rx={Math.min(4, barW / 2)} fill="var(--series-2)" />
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--text-muted)">{fmtDay(d.date)}</text>
              )}
            </g>
          );
        })}
      </svg>
      <details style={{ marginTop: 6 }}>
        <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>Show as table</summary>
        <div className="scroll">
          <table>
            <thead><tr><th>Date</th><th>In hours</th><th>After hours</th><th>Total</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}><td>{fmtDay(d.date)}</td><td>{d.inHours}</td><td>{d.afterHours}</td><td>{d.inHours + d.afterHours}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Horizontal bars, one series (the title names it), every bar direct-labelled with count and share. */
export function OutcomeBars({ rows }: { rows: { label: string; count: number }[] }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${r.count} of ${total}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>{r.label}</span>
            <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.count}{total ? ` · ${Math.round((100 * r.count) / total)}%` : ''}</span>
          </div>
          <div style={{ height: 10, marginTop: 4, background: 'var(--border)', borderRadius: 4 }}>
            <div style={{ width: `${(100 * r.count) / max}%`, height: '100%', background: 'var(--series-1)', borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
