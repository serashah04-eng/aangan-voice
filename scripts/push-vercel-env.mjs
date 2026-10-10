// Copies the server env vars from .env.local into the linked Vercel project (production + preview)
// without printing any value. Generates CRON_SECRET if missing (and saves it to .env.local).
// Usage: node scripts/push-vercel-env.mjs [APP_BASE_URL]
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';

const FILE = '.env.local';
if (!existsSync(FILE)) throw new Error('.env.local not found');
process.loadEnvFile(FILE);

if (!(process.env.CRON_SECRET ?? '').trim()) {
  process.env.CRON_SECRET = randomBytes(32).toString('hex');
  appendFileSync(FILE, `\n# Protects /api/cron/outbox (Vercel Cron sends it as a Bearer token)\nCRON_SECRET=${process.env.CRON_SECRET}\n`);
  console.log('generated CRON_SECRET (saved to .env.local)');
}
if (process.argv[2]) process.env.APP_BASE_URL = process.argv[2];

const NAMES = [
  'GEMINI_API_KEY', 'GEMINI_MODEL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'HUBSPOT_PRIVATE_APP_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_DESIGNER_CHAT_ID', 'TELEGRAM_STUDIO_HEAD_CHAT_ID',
  'RESEND_API_KEY', 'RESEND_FROM', 'DESIGNER_FALLBACK_EMAIL', 'STUDIO_HEAD_EMAIL',
  'CALCOM_API_KEY', 'CALCOM_EVENT_TYPE_ID', 'CALENDAR_ATTENDEE_EMAIL', 'CRON_SECRET', 'APP_BASE_URL',
  'DASHBOARD_PASSWORD', 'DASHBOARD_SESSION_SECRET', 'VAANI_API_KEY', 'VAANI_WEBHOOK_SECRET', 'VAANI_AGENT_ID',
].filter((n) => !process.env.ONLY || process.env.ONLY.split(',').includes(n));

for (const name of NAMES) {
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    console.log(`skip ${name} (empty)`);
    continue;
  }
  for (const target of ['production', 'preview']) {
    spawnSync('npx', ['vercel', 'env', 'rm', name, target, '--yes'], { shell: true, stdio: 'ignore' });
    const r = spawnSync('npx', ['vercel', 'env', 'add', name, target], { shell: true, input: value, encoding: 'utf8' });
    const ok = r.status === 0;
    console.log(`${ok ? 'set ' : 'FAIL'} ${name} [${target}]${ok ? '' : ` — ${(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(-1)[0] ?? ''}`}`);
  }
}
