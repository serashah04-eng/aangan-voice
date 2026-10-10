import { computeDashboard, OUTCOME_LABEL } from '../../src/dashboard/metrics';
import { loadDashboardData } from '../../src/dashboard/load';
import { CallsPerDayChart, OutcomeBars } from './charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Aangan Dashboard', robots: { index: false } };

const RANGES = [7, 30, 90] as const;
const DEFAULT_DAYS = 90;
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const num = (x: number | null, d = 0) => (x === null ? '—' : x.toFixed(d));
const inr = (usd: number | null, fx: number) => (usd === null ? '—' : `₹ ${(usd * fx).toLocaleString('en-IN', { maximumFractionDigits: usd * fx < 10 ? 2 : 0 })}`);
const mins = (m: number | null) => (m === null ? '—' : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);
const mask = (phone: string) => `${phone.slice(0, 3)}•••••${phone.slice(-4)}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub ? <div className="tile-sub">{sub}</div> : null}
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: daysParam } = await searchParams;
  const days = RANGES.includes(Number(daysParam) as (typeof RANGES)[number]) ? Number(daysParam) : DEFAULT_DAYS;
  const now = new Date();
  const from = new Date(now.getTime() - (days - 1) * 86_400_000);
  from.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const loadFrom = (from < monthStart ? from : monthStart).toISOString();

  let data;
  try {
    data = await loadDashboardData(loadFrom);
  } catch (e) {
    return (
      <main className="page">
        <h1>Aangan Dashboard</h1>
        <p role="alert">⚠ Could not load data: {(e as Error).message}</p>
      </main>
    );
  }
  const m = computeDashboard(data, { from: from.toISOString(), to: now.toISOString(), now });
  const fx = m.cost.fx;

  return (
    <main className="page">
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Aangan phone line</h1>
          <div className="muted" style={{ fontSize: 13 }}>Read-only · times in IST · rates from config</div>
        </div>
        <nav style={{ display: 'flex', gap: 6, alignItems: 'center' }} aria-label="Date range">
          {RANGES.map((r) => (
            <a key={r} className="chip" href={`/dashboard?days=${r}`} aria-current={r === days ? 'page' : undefined}>Last {r} days</a>
          ))}
          <form method="post" action="/api/auth/logout" style={{ marginLeft: 8 }}>
            <button className="chip" style={{ background: 'transparent', cursor: 'pointer' }}>Sign out</button>
          </form>
        </nav>
      </header>

      <section className="grid tiles" aria-label="Headline numbers">
        <Tile label="Calls" value={String(m.volume.calls)} sub={`${m.volume.enquiries} enquiries · ${m.volume.other} other`} />
        <Tile label="After hours" value={pct(m.volume.afterHoursShare)} sub={`${m.volume.afterHours} calls outside 10am–7pm`} />
        <Tile label="Time to answer" value={m.answer.medianSec === null ? '—' : `${num(m.answer.medianSec, 1)} s`} sub={`median · p90 ${num(m.answer.p90Sec, 1)} s`} />
        <Tile label="Qualified" value={String(m.outcomes.qualified)} sub={`${pct(m.volume.enquiries ? m.outcomes.qualified / m.volume.enquiries : null)} of enquiries`} />
        <Tile label="Qualified → handoff" value={mins(m.handoff.medianMinutes)} sub={`median · ${m.handoff.sent} handoffs sent`} />
        <Tile label="Handoff → booking" value={pct(m.booking.rate)} sub={`${m.booking.booked} booked · ${m.booking.pendingOrFailed} pending/failed`} />
        <Tile label="Asked about price" value={pct(m.pricing.rate)} sub={`${m.pricing.asked} enquiries · never quoted`} />
        <Tile label="Follow-up backlog" value={String(m.followups.open)} sub={m.followups.oldestOpenDays === null ? 'none open' : `oldest ${num(m.followups.oldestOpenDays, 1)} days`} />
      </section>

      <section className="grid two" style={{ marginTop: 12 }}>
        <div className="card">
          <h2>Calls per day</h2>
          <CallsPerDayChart days={m.volume.perDay} />
        </div>
        <div className="card">
          <h2>Outcome mix (enquiries)</h2>
          <OutcomeBars rows={m.outcomes.mix.map((o) => ({ label: o.label, count: o.count }))} />
        </div>
      </section>

      <section className="grid two" style={{ marginTop: 12 }}>
        <div className="card">
          <h2>Running cost</h2>
          <div className="grid tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
            <div><div className="tile-label">Per call</div><div className="tile-value" style={{ fontSize: 22 }}>{inr(m.cost.perCall, fx)}</div></div>
            <div><div className="tile-label">Per qualified lead</div><div className="tile-value" style={{ fontSize: 22 }}>{inr(m.cost.perQualified, fx)}</div></div>
            <div><div className="tile-label">This month</div><div className="tile-value" style={{ fontSize: 22 }}>{inr(m.cost.monthToDate, fx)}</div><div className="tile-sub">projected {inr(m.cost.projectedMonth, fx)}</div></div>
          </div>
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Component ({m.window.days} days)</th><th>Cost</th></tr></thead>
            <tbody>
              <tr><td>Telephony + voice (Vaani, ₹{m.cost.telephonyInrPerMinute}/min)</td><td>{inr(m.cost.window.telephony, fx)}</td></tr>
              <tr><td>Model (Gemini extraction)</td><td>{inr(m.cost.window.llm, fx)}</td></tr>
              <tr><td>Notifications (Telegram / email)</td><td>{inr(m.cost.window.notify, fx)}</td></tr>
              <tr><th>Total</th><th>{inr(m.cost.window.total, fx)}</th></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Escalations</h2>
          <div className="grid tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
            <div><div className="tile-label">Escalated</div><div className="tile-value" style={{ fontSize: 22 }}>{m.escalations.total}</div></div>
            <div><div className="tile-label">Alert sent</div><div className="tile-value" style={{ fontSize: 22 }}>{m.escalations.alerted}</div></div>
            <div><div className="tile-label">Resolved</div><div className="tile-value" style={{ fontSize: 22 }}>{m.escalations.resolved}</div></div>
            <div><div className="tile-label">Median to resolve</div><div className="tile-value" style={{ fontSize: 22 }}>{m.escalations.medianResolutionHours === null ? '—' : `${num(m.escalations.medianResolutionHours, 1)} h`}</div></div>
          </div>
          <h2 style={{ marginTop: 16 }}>Follow-up backlog by reason</h2>
          {m.followups.byReason.length ? (
            <table><tbody>{m.followups.byReason.map(([r, n]) => <tr key={r}><td>{r.replace(/_/g, ' ')}</td><td>{n}</td></tr>)}</tbody></table>
          ) : <p className="muted" style={{ margin: 0 }}>Nothing open.</p>}
        </div>
      </section>

      <section className="grid two" style={{ marginTop: 12 }}>
        <div className="card">
          <h2>Rules vs model disagreements</h2>
          <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>
            The rules engine always decides; the model&apos;s own guess is logged for monitoring. {m.disagreements.count} of {m.disagreements.compared} calls differ ({pct(m.disagreements.rate)}).
          </p>
          {m.disagreements.recent.length ? (
            <div className="scroll"><table>
              <thead><tr><th>When</th><th>Rules decided</th><th>Model guessed</th><th /></tr></thead>
              <tbody>{m.disagreements.recent.map((d) => (
                <tr key={d.id}><td>{when(d.at)}</td><td>{OUTCOME_LABEL[d.rules] ?? d.rules}</td><td>{OUTCOME_LABEL[d.model] ?? d.model}</td><td><a href={`/dashboard/calls/${d.id}`}>open</a></td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className="muted" style={{ margin: 0 }}>No disagreements in this range.</p>}
        </div>

        <div className="card">
          <h2>Integration errors</h2>
          <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>{m.errors.total} errors · {m.errors.unresolved} unresolved. Call records are never lost — failed steps retry automatically.</p>
          {m.errors.byService.length ? (
            <div className="scroll"><table>
              <thead><tr><th>Service</th><th>Errors</th></tr></thead>
              <tbody>{m.errors.byService.map(([s, n]) => <tr key={s}><td>{s}</td><td>{n}</td></tr>)}</tbody>
            </table></div>
          ) : <p className="muted" style={{ margin: 0 }}>✓ No integration errors in this range.</p>}
        </div>
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <h2>Recent calls</h2>
        <div className="scroll"><table>
          <thead><tr><th>When</th><th>Caller</th><th>Outcome</th><th>After hours</th><th>Price asked</th><th /></tr></thead>
          <tbody>
            {data.calls.slice(-15).reverse().map((c) => (
              <tr key={c.id}>
                <td>{when(c.started_at)}</td>
                <td>{mask(c.caller_phone_e164)}</td>
                <td>{c.outcome ? OUTCOME_LABEL[c.outcome] : '—'}</td>
                <td>{c.after_hours ? 'yes' : 'no'}</td>
                <td>{c.pricing_asked_count > 0 ? `${c.pricing_asked_count}×` : '—'}</td>
                <td><a href={`/dashboard/calls/${c.id}`}>details</a></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </main>
  );
}
