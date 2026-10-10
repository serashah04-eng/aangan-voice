import { RULES_CONFIG_VERSION } from '../config/rules.config';

/** Public landing page: shows nothing about calls or leads (the dashboard is Phase 5, behind auth). */
export default function Home() {
  return (
    <main className="page" style={{ maxWidth: 640, paddingTop: 64 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Aangan Phone Agent</h1>
      <p className="muted" style={{ lineHeight: 1.6 }}>
        Backend for Aangan Studio&apos;s AI phone enquiry line. Call handling, qualification, designer handoffs and CRM sync run
        server-side.
      </p>
      <p style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a href="/talk" className="button" style={{ textDecoration: 'none', display: 'inline-block' }}>Talk to the agent</a>
        <a href="/dashboard" className="chip" style={{ padding: '10px 14px' }}>Open dashboard</a>
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 32 }}>Rules config v{RULES_CONFIG_VERSION}</p>
    </main>
  );
}
