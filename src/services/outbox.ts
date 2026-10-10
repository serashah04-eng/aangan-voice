import { rulesConfig } from '../../config/rules.config';
import type { CrmClient } from '../adapters/crm/types';
import type { Notifier, OutgoingMessage } from '../adapters/notify/types';
import type { Store } from '../adapters/store/types';
import type { JobRow } from '../domain/records';
import { logger, redactPhones } from '../lib/logger';
import { dealDescription, designerHandoffMessage, escalationMessage, type LeadSummary } from './lead-summary';

export type OutboxTargets = {
  designerChatId: string;
  studioHeadChatId: string;
  designerEmail: string;
  studioHeadEmail: string;
  /** Base URL for "link to the full record" in handoffs. */
  appBaseUrl: string;
};

export type OutboxDeps = {
  store: Store;
  crm: CrmClient;
  telegram: Notifier;
  email: Notifier;
  targets: OutboxTargets;
  now?: () => Date;
};

export type OutboxRunReport = { claimed: number; done: number; retried: number; dead: number };

const SERVICE_OF: Record<string, string> = {
  hubspot_sync: 'hubspot',
  designer_handoff: 'telegram',
  escalation_alert: 'telegram',
  integration_alert: 'telegram',
};

export function backoffSeconds(attempt: number): number {
  const o = rulesConfig.outbox;
  return Math.min(o.backoffMaxSeconds, o.backoffBaseSeconds * 2 ** Math.max(0, attempt - 1));
}

const recordUrl = (t: OutboxTargets, callId: string) => `${t.appBaseUrl.replace(/\/+$/, '')}/dashboard/calls/${callId}`;

/**
 * Q14: Telegram first; after `notifyFallbackAfterAttempts` failed Telegram attempts the job
 * switches to email. Returns the channel actually used.
 */
async function deliver(deps: OutboxDeps, job: JobRow, chatId: string, emailTo: string, msg: OutgoingMessage) {
  const useEmail = job.attempts > rulesConfig.integrations.notifyFallbackAfterAttempts;
  const notifier = useEmail ? deps.email : deps.telegram;
  await notifier.send(useEmail ? emailTo : chatId, msg);
  return notifier.channel;
}

async function handle(deps: OutboxDeps, job: JobRow): Promise<void> {
  const p = job.payload as { leadId?: string; callId?: string; outcome?: string; summary?: LeadSummary; message?: OutgoingMessage };
  const t = deps.targets;

  switch (job.kind) {
    case 'hubspot_sync': {
      const lead = p.leadId ? await deps.store.getLead(p.leadId) : null;
      if (!lead || !p.summary) throw new Error('hubspot_sync: lead not found');
      const contactId = await deps.crm.upsertContactByPhone({ phoneE164: lead.phone_e164, name: lead.name });
      let dealId = lead.hubspot_deal_id;
      if ((rulesConfig.integrations.hubspotDealOutcomes as readonly string[]).includes(p.outcome ?? '')) {
        dealId = await deps.crm.upsertDeal({
          contactId,
          dealId,
          name: `Aangan — ${lead.name ?? lead.phone_e164}${lead.locality_raw ? ` — ${lead.locality_raw}` : ''}`,
          pipeline: rulesConfig.integrations.hubspotPipeline,
          stage: rulesConfig.integrations.hubspotDealStage[p.outcome!]!,
          description: `${dealDescription(p.summary)}\nRecord: ${recordUrl(t, p.callId ?? '')}`,
        });
      }
      await deps.store.updateLead(lead.id, { hubspot_contact_id: contactId, hubspot_deal_id: dealId });
      return;
    }

    case 'designer_handoff':
    case 'escalation_alert': {
      if (!p.summary || !p.callId) throw new Error(`${job.kind}: payload incomplete`);
      const isDesigner = job.kind === 'designer_handoff';
      const msg = isDesigner ? designerHandoffMessage(p.summary, recordUrl(t, p.callId)) : escalationMessage(p.summary, recordUrl(t, p.callId));
      const base = {
        lead_id: p.leadId ?? null,
        call_id: p.callId,
        kind: (isDesigner ? 'designer' : 'escalation') as 'designer' | 'escalation',
        idempotency_key: job.idempotency_key,
        payload: msg,
        attempts: job.attempts,
      };
      try {
        const channel = await deliver(deps, job, isDesigner ? t.designerChatId : t.studioHeadChatId, isDesigner ? t.designerEmail : t.studioHeadEmail, msg);
        await deps.store.saveHandoff({ ...base, channel, status: 'sent', sent_at: (deps.now?.() ?? new Date()).toISOString() });
      } catch (e) {
        const channel = job.attempts > rulesConfig.integrations.notifyFallbackAfterAttempts ? 'email' : 'telegram';
        await deps.store.saveHandoff({ ...base, channel, status: 'failed', sent_at: null });
        throw e;
      }
      return;
    }

    case 'integration_alert': {
      if (!p.message) throw new Error('integration_alert: no message');
      await deliver(deps, job, t.studioHeadChatId, t.studioHeadEmail, p.message);
      return;
    }
  }
}

/**
 * Drain due jobs: claim → run → done, or record the error and retry with exponential backoff.
 * After `alertAfterFailures` failures of one job the studio head is alerted (S22); after
 * `max_attempts` the job is dead and a front-desk task is opened. The Supabase call record is
 * untouched throughout.
 */
export async function processOutbox(deps: OutboxDeps, limit = 10): Promise<OutboxRunReport> {
  const now = () => deps.now?.() ?? new Date();
  const jobs = await deps.store.claimJobs(limit);
  const report: OutboxRunReport = { claimed: jobs.length, done: 0, retried: 0, dead: 0 };

  for (const job of jobs) {
    try {
      await handle(deps, job);
      await deps.store.completeJob(job.id);
      report.done++;
    } catch (e) {
      const message = redactPhones((e as Error).message ?? String(e));
      const service = job.kind === 'designer_handoff' || job.kind === 'escalation_alert' || job.kind === 'integration_alert'
        ? (job.attempts > rulesConfig.integrations.notifyFallbackAfterAttempts ? 'resend' : 'telegram')
        : SERVICE_OF[job.kind] ?? job.kind;
      await deps.store.addIntegrationError({
        service, operation: job.kind, idempotency_key: job.idempotency_key, call_id: job.call_id, lead_id: job.lead_id,
        attempt: job.attempts, error_code: null, message,
      });

      const dead = job.attempts >= job.max_attempts;
      const next = dead ? null : new Date(now().getTime() + backoffSeconds(job.attempts) * 1000).toISOString();
      await deps.store.failJob(job.id, message, next);
      if (dead) report.dead++;
      else report.retried++;
      logger.warn('outbox.job_failed', { jobId: job.id, kind: job.kind, attempt: job.attempts, dead, message });

      if (job.kind !== 'integration_alert' && job.attempts === rulesConfig.outbox.alertAfterFailures) {
        await deps.store.enqueueJob({
          kind: 'integration_alert',
          idempotency_key: `integration_alert:${job.id}`,
          call_id: job.call_id,
          lead_id: job.lead_id,
          payload: {
            message: {
              subject: `Integration failing: ${job.kind}`,
              body: `"${job.kind}" has failed ${job.attempts} times (last error: ${message.slice(0, 300)}). The call record is safe in Supabase; the system keeps retrying.`,
            },
          },
        });
      }
      if (dead && job.kind !== 'integration_alert') {
        await deps.store.addFollowupTask({
          lead_id: job.lead_id, call_id: job.call_id, reason: 'integration_failure', missing_fields: [],
          notes: `${job.kind} gave up after ${job.attempts} attempts — please do this step by hand.`,
        });
      }
    }
  }
  return report;
}
