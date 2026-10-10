import { rulesConfig } from '../../config/rules.config';
import type { Store } from '../adapters/store/types';
import type { CallRow } from '../domain/records';

/**
 * Dropped calls (brief §5): if the same number called within the resume window and that call
 * didn't complete, continue the same record instead of starting over (T17).
 */
export async function findResumableCall(store: Store, phone: string, now: Date): Promise<CallRow | null> {
  const since = new Date(now.getTime() - rulesConfig.dialogue.resumeWindowMinutes * 60_000).toISOString();
  const recent = await store.findRecentCallByPhone(phone, since);
  return recent && (recent.status === 'dropped' || recent.status === 'in_progress') ? recent : null;
}
