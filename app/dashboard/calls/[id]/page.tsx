import { loadCallDetail } from '../../../../src/dashboard/load';
import { OUTCOME_LABEL } from '../../../../src/dashboard/metrics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Call · Aangan Dashboard', robots: { index: false } };

const STATE_MARK: Record<string, string> = {
  pass: '✓ pass', pass_tight: '✓ pass (tight)', pass_with_note: '✓ pass (note)', not_mentioned: '— not mentioned',
  unknown: '? unknown', fail: '✕ fail', escalate: '⚠ escalate', triggered: '⚠ triggered',
};

/** The "link to the full record" from every handoff: transcript, per-criterion evidence, integrations. */
export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadCallDetail(id);
  if (!d.call) {
    return <main className="page"><p>Call not found.</p><a href="/dashboard">← Dashboard</a></main>;
  }
  const c = d.call as Record<string, string | number | boolean | null>;
  const lead = d.lead as Record<string, string | number | boolean | null> | null;
  const when = new Date(String(c.started_at)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  return (
    <main className="page">
      <a href="/dashboard" className="muted" style={{ fontSize: 13 }}>← Dashboard</a>
      <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>{lead?.name ? String(lead.name) : 'Caller'} · {c.outcome ? OUTCOME_LABEL[String(c.outcome)] : '—'}</h1>
      <div className="muted" style={{ fontSize: 13 }}>
        {String(c.caller_phone_e164)} · {when} IST · {c.duration_s ? `${c.duration_s}s` : 'duration n/a'} · rule {String(c.outcome_rule_id ?? '—')} · rules {String(c.rules_version ?? '—').slice(0, 10)} · prompt {String(c.prompt_version ?? '—')}
      </div>

      <section className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Qualification evidence</h2>
          <div className="scroll"><table>
            <thead><tr><th>Criterion</th><th>State</th><th>Evidence (caller&apos;s words)</th></tr></thead>
            <tbody>{d.evidence.map((e, i) => (
              <tr key={i}>
                <td>{e.criterion}</td>
                <td title={e.rule_id}>{STATE_MARK[e.state] ?? e.state}{e.follow_up_asked ? ' · asked' : ''}</td>
                <td>{e.evidence_quote ? `“${e.evidence_quote}”` : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
        <div className="card">
          <h2>Lead</h2>
          {lead ? (
            <table><tbody>
              {(['locality_raw', 'project_type', 'scope', 'area_sqft', 'completion_by', 'site_available_from', 'tight_timeline', 'budget_raw', 'decider_note', 'pricing_asked', 'consultation_preference', 'hubspot_contact_id', 'hubspot_deal_id'] as const).map((k) => (
                <tr key={k}><th style={{ width: '42%' }}>{k.replace(/_/g, ' ')}</th><td>{lead[k] === null || lead[k] === undefined || lead[k] === '' ? '—' : String(lead[k])}</td></tr>
              ))}
            </tbody></table>
          ) : <p className="muted">No lead (not an enquiry).</p>}
          <h2 style={{ marginTop: 16 }}>Integrations</h2>
          <table><tbody>
            {d.jobs.map((j, i) => <tr key={`j${i}`}><td>{j.kind.replace(/_/g, ' ')}</td><td>{j.status} · {j.attempts} attempt(s){j.last_error ? ` · ${j.last_error.slice(0, 80)}` : ''}</td></tr>)}
            {d.handoffs.map((h, i) => <tr key={`h${i}`}><td>{h.kind} handoff</td><td>{h.status} via {h.channel}</td></tr>)}
            {d.bookings.map((b, i) => <tr key={`b${i}`}><td>booking</td><td>{b.status}{b.slot_start ? ` · ${new Date(b.slot_start).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}{b.preference ? ` · pref: ${b.preference}` : ''}</td></tr>)}
            {!d.jobs.length && !d.handoffs.length && !d.bookings.length ? <tr><td className="muted">Nothing external (Supabase only).</td></tr> : null}
          </tbody></table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <h2>Transcript</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          {d.turns.map((t) => (
            <div key={t.turn_index} style={{ fontSize: 14 }}>
              <span className="tile-label" style={{ display: 'inline-block', width: 64 }}>{t.speaker === 'agent' ? 'Agent' : 'Caller'}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
