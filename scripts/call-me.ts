/**
 * Ask Vaani to place ONE outbound test call to DEMO_CALLER_NUMBER (your phone), using the agent
 * in VAANI_AGENT_ID. Costs real telephony minutes, so it requires --yes.
 *   npm run call:me -- --yes
 * Before this works end to end, the agent's BYOL URL must point at a running voice server.
 */
import { loadLocalEnv } from '../src/services/container';

loadLocalEnv();
if (!process.argv.includes('--yes')) {
  console.log('This places a real phone call (costs telephony minutes). Re-run with --yes to confirm.');
  process.exit(0);
}
const key = (process.env.VAANI_API_KEY ?? '').trim();
const agentId = (process.env.VAANI_AGENT_ID ?? '').trim();
const to = (process.env.DEMO_CALLER_NUMBER ?? '').trim();
if (!key || !agentId || !/^\+\d{10,15}$/.test(to)) throw new Error('Need VAANI_API_KEY, VAANI_AGENT_ID and DEMO_CALLER_NUMBER (+91…) in .env.local');

const res = await fetch('https://api.vaanivoice.ai/api/trigger-call/', {
  method: 'POST',
  headers: { 'X-API-Key': key, 'Content-Type': 'application/json', 'X-Agent-Id': 'aangan-phone-agent' },
  body: JSON.stringify({ agent_id: agentId, medium: 'telephony', contact_number: to, name: 'Demo caller' }),
});
const body = await res.text();
console.log(`trigger-call → ${res.status}`);
console.log(body.replace(/\+?\d{10,13}/g, (m) => `•••${m.slice(-4)}`).slice(0, 400));
