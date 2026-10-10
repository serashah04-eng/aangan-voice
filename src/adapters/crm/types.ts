export type CrmContactInput = {
  phoneE164: string;
  name?: string | null;
  /** Free-text summary for the contact record (no pricing). */
  note?: string;
};

export type CrmDealInput = {
  contactId: string;
  /** Existing deal id if we created one before (idempotent update). */
  dealId?: string | null;
  name: string;
  stage: string;
  pipeline: string;
  description: string;
};

/** CRM behind an interface; HubSpot in production, in-memory mock in tests. */
export interface CrmClient {
  /** Find a contact by phone; update it if found, otherwise create it. Returns the contact id. */
  upsertContactByPhone(input: CrmContactInput): Promise<string>;
  /** Create (or update, if dealId given) a deal associated with the contact. Returns the deal id. */
  upsertDeal(input: CrmDealInput): Promise<string>;
}
