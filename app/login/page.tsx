export const metadata = { title: 'Sign in · Aangan Dashboard' };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return (
    <main className="page" style={{ maxWidth: 380, paddingTop: 96 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Aangan Dashboard</h1>
      <p className="muted" style={{ marginTop: 0 }}>Read-only. Enter the dashboard password.</p>
      <form method="post" action="/api/auth/login" style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        <input type="hidden" name="next" value={next ?? '/dashboard'} />
        <label className="muted" htmlFor="pw" style={{ fontSize: 13 }}>Password</label>
        <input id="pw" name="password" type="password" required autoFocus className="input" />
        {error ? (
          <p role="alert" style={{ color: 'var(--critical)', margin: 0, fontSize: 14 }}>
            ⚠ Wrong password.
          </p>
        ) : null}
        <button type="submit" className="button">Sign in</button>
      </form>
    </main>
  );
}
