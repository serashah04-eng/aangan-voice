import { redactPhones } from '../../lib/logger';
import type { CrmClient, CrmContactInput, CrmDealInput } from './types';

export class HubSpotError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * HubSpot CRM v3 adapter (Service Key / private app token, Bearer auth).
 * Scopes: crm.objects.contacts.read/write, crm.objects.deals.read/write.
 */
export class HubSpotCrm implements CrmClient {
  private readonly fetch: typeof fetch;
  private readonly base = 'https://api.hubapi.com';

  constructor(private readonly token: string, fetchImpl?: typeof fetch) {
    if (!token) throw new Error('HUBSPOT_PRIVATE_APP_TOKEN is not set');
    this.fetch = fetchImpl ?? fetch;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new HubSpotError(res.status, `hubspot ${method} ${path} → ${res.status}: ${redactPhones(text).slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  async upsertContactByPhone(input: CrmContactInput): Promise<string> {
    const found = await this.req<{ results: { id: string }[] }>('POST', '/crm/v3/objects/contacts/search', {
      filterGroups: [{ filters: [{ propertyName: 'phone', operator: 'EQ', value: input.phoneE164 }] }],
      properties: ['phone', 'firstname'],
      limit: 1,
    });
    const properties: Record<string, string> = { phone: input.phoneE164 };
    if (input.name) properties.firstname = input.name;
    // The call summary goes on the deal description; contacts only get standard properties.

    const existing = found.results[0]?.id;
    if (existing) {
      await this.req('PATCH', `/crm/v3/objects/contacts/${existing}`, { properties });
      return existing;
    }
    const created = await this.req<{ id: string }>('POST', '/crm/v3/objects/contacts', { properties });
    return created.id;
  }

  async upsertDeal(input: CrmDealInput): Promise<string> {
    const properties = { dealname: input.name, pipeline: input.pipeline, dealstage: input.stage, description: input.description.slice(0, 65000) };
    if (input.dealId) {
      await this.req('PATCH', `/crm/v3/objects/deals/${input.dealId}`, { properties });
      return input.dealId;
    }
    const created = await this.req<{ id: string }>('POST', '/crm/v3/objects/deals', {
      properties,
      associations: [
        // HubSpot-defined association type 3 = deal → contact.
        { to: { id: input.contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] },
      ],
    });
    return created.id;
  }
}
