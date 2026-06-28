/**
 * SMS / voice alert send-path SCAFFOLD (open-tasks Task 6/14 — "scaffold only, no live provider").
 *
 * This is the Premium-gated interface a real provider (Twilio, etc.) plugs into later. Nothing here
 * actually sends — `noopSmsSender` is wired by default — so it changes NO behavior; it exists so the
 * gating + dispatch shape are defined and unit-tested, and so a future provider is a one-file drop-in.
 *
 * Decided model: SMS/voice escalation is a PREMIUM entitlement (mirrors `canSmsAlert` in
 * dashboard/src/utils/entitlements.ts) AND is per-event opt-in (a user picks which alerts escalate to
 * SMS). Phone numbers + opted-in event keys travel in `SmsPrefs` (the client/account portal owns the
 * UI + validation; this layer trusts already-validated input).
 */

/** Premium-only SMS/voice escalation. Mirrors canSmsAlert in entitlements.ts. */
export function canSmsAlertForTier(tier: string | null | undefined): boolean {
  return tier === 'premium';
}

export interface SmsPrefs {
  /** Destination phone numbers (E.164-ish; validated upstream in the account portal). */
  phones: string[];
  /** Event keys the user has opted into SMS for (e.g. 'flood', 'offline', 'low_battery'). */
  events: string[];
}

/**
 * The phone numbers that should receive an SMS for `event`. Returns [] unless the vehicle's tier is
 * Premium AND the event is opted in AND there is at least one number. Numbers are trimmed, de-duped,
 * and blanks dropped. Pure.
 */
export function smsRecipientsForEvent(
  tier: string | null | undefined,
  prefs: SmsPrefs | null | undefined,
  event: string,
): string[] {
  if (!canSmsAlertForTier(tier)) return [];
  if (!event) return [];
  if (!prefs || !Array.isArray(prefs.phones) || !Array.isArray(prefs.events)) return [];
  if (!prefs.events.includes(event)) return [];
  return [...new Set(prefs.phones.map((p) => String(p).trim()).filter(Boolean))];
}

/** Send-path interface. A real provider implements this; the worker depends only on the interface. */
export interface SmsSender {
  sendSms(to: string, body: string): Promise<{ ok: boolean; error?: string }>;
}

/**
 * Default sender until a provider is configured: sends nothing and reports not-configured, so an
 * alert path can record the gap (and a future "SMS send-success" ops signal can surface it) without
 * ever crashing. Logs the intent for visibility in `wrangler tail`.
 */
export const noopSmsSender: SmsSender = {
  async sendSms(to: string, _body: string) {
    console.log(`[sms] no provider configured — would SMS ${to}`);
    return { ok: false, error: 'no SMS provider configured' };
  },
};

/**
 * Fan an event's SMS out to every entitled recipient through `sender`. With the default
 * `noopSmsSender` this attempts but sends nothing (scaffold); with a real provider it sends. Returns
 * attempted/sent counts so a caller can report delivery the way the FCM path already does.
 */
export async function dispatchSmsForEvent(
  sender: SmsSender,
  tier: string | null | undefined,
  prefs: SmsPrefs | null | undefined,
  event: string,
  body: string,
): Promise<{ attempted: number; sent: number }> {
  const recipients = smsRecipientsForEvent(tier, prefs, event);
  let sent = 0;
  for (const to of recipients) {
    try {
      const r = await sender.sendSms(to, body);
      if (r.ok) sent++;
    } catch {
      /* a provider error for one number must not abort the others */
    }
  }
  return { attempted: recipients.length, sent };
}
