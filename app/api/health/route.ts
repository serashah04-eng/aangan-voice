import { RULES_CONFIG_VERSION } from '../../../config/rules.config';
import { DEFAULT_RULES_VERSION } from '../../../src/rules/version';

export const dynamic = 'force-dynamic';

/** Liveness check. Reveals no secrets and no data — only versions and whether config is complete. */
export function GET() {
  const required = [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'HUBSPOT_PRIVATE_APP_TOKEN', 'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_DESIGNER_CHAT_ID', 'TELEGRAM_STUDIO_HEAD_CHAT_ID', 'RESEND_API_KEY', 'RESEND_FROM',
    'CALCOM_API_KEY', 'CALCOM_EVENT_TYPE_ID', 'GEMINI_API_KEY', 'CRON_SECRET',
  ];
  const missing = required.filter((k) => !(process.env[k] ?? '').trim()).length;
  return Response.json({ ok: missing === 0, configured: required.length - missing, required: required.length, rulesVersion: DEFAULT_RULES_VERSION.slice(0, 12), configVersion: RULES_CONFIG_VERSION });
}
