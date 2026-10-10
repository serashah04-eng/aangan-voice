import { existsSync } from 'node:fs';
import { CalcomCalendar } from '../adapters/calendar/calcom';
import { GoogleCalendar } from '../adapters/calendar/google';
import type { CalendarProvider } from '../adapters/calendar/types';
import { HubSpotCrm } from '../adapters/crm/hubspot';
import { ResendNotifier } from '../adapters/notify/resend';
import { TelegramNotifier } from '../adapters/notify/telegram';
import { SupabaseStore } from '../adapters/store/supabase';
import { rulesConfig } from '../../config/rules.config';
import { costConfig } from '../../config/cost.config';
import { GeminiClient } from '../adapters/llm/gemini';
import type { OutboxDeps } from './outbox';

/** Load .env.local when running scripts locally (Vercel injects env vars itself). */
export function loadLocalEnv(path = '.env.local'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

function env(name: string, required = true): string {
  const v = (process.env[name] ?? '').trim();
  if (!v && required) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

/** Real adapters wired from environment variables. Server-side only. */
export function buildStore() {
  return new SupabaseStore({ url: env('SUPABASE_URL'), serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY') });
}

export function buildOutboxDeps(): OutboxDeps {
  return {
    store: buildStore(),
    crm: new HubSpotCrm(env('HUBSPOT_PRIVATE_APP_TOKEN')),
    telegram: new TelegramNotifier(env('TELEGRAM_BOT_TOKEN')),
    email: new ResendNotifier(env('RESEND_API_KEY'), env('RESEND_FROM')),
    targets: {
      designerChatId: env('TELEGRAM_DESIGNER_CHAT_ID'),
      studioHeadChatId: env('TELEGRAM_STUDIO_HEAD_CHAT_ID'),
      designerEmail: env('DESIGNER_FALLBACK_EMAIL'),
      studioHeadEmail: env('STUDIO_HEAD_EMAIL'),
      appBaseUrl: env('APP_BASE_URL', false) || 'http://localhost:3000',
    },
  };
}

/** Gemini client: GEMINI_MODEL (default from cost config), with GEMINI_API_KEY_FALLBACK as backup. */
export function buildLlm(modelOverride?: string): GeminiClient {
  return new GeminiClient({
    apiKey: env('GEMINI_API_KEY', false),
    fallbackApiKey: env('GEMINI_API_KEY_FALLBACK', false) || undefined,
    model: modelOverride || env('GEMINI_MODEL', false) || costConfig.defaultModel,
    thinkingLevel: env('GEMINI_THINKING_LEVEL', false) || undefined,
  });
}

export function buildCalendar(): CalendarProvider {
  if (rulesConfig.integrations.calendarProvider === 'calcom') {
    return new CalcomCalendar({
      apiKey: env('CALCOM_API_KEY'),
      eventTypeId: env('CALCOM_EVENT_TYPE_ID'),
      attendeeEmail: env('CALENDAR_ATTENDEE_EMAIL', false) || env('DESIGNER_FALLBACK_EMAIL'),
      timeZone: rulesConfig.calendar.timeZone,
    });
  }
  return new GoogleCalendar({ calendarId: env('GOOGLE_CALENDAR_ID'), serviceAccountJson: env('GOOGLE_SERVICE_ACCOUNT_JSON') });
}
