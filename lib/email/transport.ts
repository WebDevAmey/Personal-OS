// lib/email/transport.ts
// Outbound transactional email (OTP codes only). Resend in production;
// in development and tests, messages are captured in memory and never sent.
import { Resend } from 'resend';
import { logger } from '@/lib/observability/logger';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

const FROM = process.env.EMAIL_FROM ?? 'Personal OS <noreply@personal-os.app>';

export const outbox: OutboundEmail[] = [];

let resend: Resend | null = null;

function shouldSendViaResend(): boolean {
  if (process.env.EMAIL_TRANSPORT === 'resend') return true;
  if (process.env.EMAIL_TRANSPORT === 'memory') return false;
  return process.env.NODE_ENV === 'production';
}

export async function sendEmail(message: OutboundEmail): Promise<void> {
  if (!shouldSendViaResend()) {
    outbox.push(message);
    logger.info('email.captured', { subject: message.subject });
    return;
  }
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY must be set to send email');
  resend ??= new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: FROM, ...message });
  if (error) throw new Error(`Email delivery failed: ${error.name}`);
}
