// Adds VAANI_BYOL_TOKEN and VAANI_WEBHOOK_SECRET to .env.local if missing. Prints nothing secret.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';

const FILE = '.env.local';
if (existsSync(FILE)) process.loadEnvFile(FILE);
const add = [];
if (!(process.env.VAANI_BYOL_TOKEN ?? '').trim()) add.push(`VAANI_BYOL_TOKEN=${randomBytes(24).toString('hex')}`);
if (!(process.env.VAANI_WEBHOOK_SECRET ?? '').trim()) add.push(`VAANI_WEBHOOK_SECRET=${randomBytes(24).toString('hex')}`);
if (add.length) appendFileSync(FILE, `\n# Vaani: BYOL socket auth token, and the secret path segment of the webhook URL\n${add.join('\n')}\n`);
console.log(add.length ? `added ${add.map((l) => l.split('=')[0]).join(', ')}` : 'already present');
