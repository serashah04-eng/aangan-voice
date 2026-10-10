// Adds DASHBOARD_PASSWORD and DASHBOARD_SESSION_SECRET to .env.local if missing. Prints nothing secret.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';

const FILE = '.env.local';
if (existsSync(FILE)) process.loadEnvFile(FILE);
const words = ['teak', 'jaali', 'arch', 'courtyard', 'terrazzo', 'brass', 'cane', 'lime', 'sandstone', 'indigo', 'mango', 'verandah'];
const pick = () => words[randomBytes(1)[0] % words.length];
let added = [];
let block = '';
if (!(process.env.DASHBOARD_PASSWORD ?? '').trim()) {
  const pw = `${pick()}-${pick()}-${pick()}-${randomBytes(2).readUInt16BE() % 9000 + 1000}`;
  block += `DASHBOARD_PASSWORD=${pw}\n`;
  added.push('DASHBOARD_PASSWORD');
}
if (!(process.env.DASHBOARD_SESSION_SECRET ?? '').trim()) {
  block += `DASHBOARD_SESSION_SECRET=${randomBytes(32).toString('hex')}\n`;
  added.push('DASHBOARD_SESSION_SECRET');
}
if (block) appendFileSync(FILE, `\n# Dashboard sign-in (password is for you; the secret signs session cookies)\n${block}`);
console.log(added.length ? `added ${added.join(', ')} to .env.local` : 'already present');
