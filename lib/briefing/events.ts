// lib/briefing/events.ts — building and sending `briefing/generate.requested`.
// Outside Inngest functions (page load, refresh route) events go through
// `sendBriefingEvents`, which uses the Inngest client; tests swap the sender.
import { inngest } from '@/inngest/client';
import { BRIEFING_EVENT, dedupeKeyFor, type BriefingEventTrigger, type BriefingRequested } from './types';

export interface BriefingEventPayload {
  name: typeof BRIEFING_EVENT;
  data: BriefingRequested;
}

export function briefingEvent(
  userId: string,
  localDate: string,
  opts: { attempts?: number; trigger: BriefingEventTrigger; requestId?: string },
): BriefingEventPayload {
  return {
    name: BRIEFING_EVENT,
    data: {
      userId,
      localDate,
      dedupeKey: dedupeKeyFor(userId, localDate, opts.attempts ?? 0),
      trigger: opts.trigger,
      ...(opts.requestId ? { requestId: opts.requestId } : {}),
    },
  };
}

type Sender = (events: BriefingEventPayload[]) => Promise<unknown>;

const defaultSender: Sender = (events) => inngest.send(events);
let sender: Sender = defaultSender;

export async function sendBriefingEvents(events: BriefingEventPayload[]): Promise<void> {
  if (events.length === 0) return;
  await sender(events);
}

/** Test seam: replace the sender (null restores the Inngest client). */
export function setBriefingEventSender(fn: Sender | null): void {
  sender = fn ?? defaultSender;
}
