import { randomUUID } from 'node:crypto';
import type { CrmClient, CrmContactInput, CrmDealInput } from './types';

/** In-memory CRM. `failNext` makes the next N calls throw (retry tests). */
export class MockCrm implements CrmClient {
  contacts = new Map<string, CrmContactInput & { id: string }>();
  deals = new Map<string, CrmDealInput & { id: string }>();
  failNext = 0;
  calls = 0;

  private maybeFail() {
    this.calls++;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('hubspot unavailable (mock)');
    }
  }

  async upsertContactByPhone(input: CrmContactInput) {
    this.maybeFail();
    const existing = [...this.contacts.values()].find((c) => c.phoneE164 === input.phoneE164);
    const id = existing?.id ?? randomUUID();
    this.contacts.set(id, { ...existing, ...input, id });
    return id;
  }

  async upsertDeal(input: CrmDealInput) {
    this.maybeFail();
    const id = input.dealId ?? randomUUID();
    this.deals.set(id, { ...input, id });
    return id;
  }
}
